/**
 * Runnable confidence-gated routing demo for Jev via the official TypeSafe API.
 *
 * Usage:
 *   node examples/route-demo.mjs                      # route a few built-in states
 *   node examples/route-demo.mjs "state text"         # route one custom state
 *   node examples/route-demo.mjs --calibrate          # sweep thresholds over a small fixture
 *
 * Reads the TypeSafe key from TYPESAFE_KEY_FILE, defaulting to
 * ~/.config/typesafe/key, and calls POST https://api.typesafe.ai/v1/systemone with
 * {state, questions, model}. The key is only read from that file and is never printed.
 * Pricing is deliberately not hard-coded: check TypeSafe's current terms before a large
 * sweep, and keep the delay between calls so the provider is not rate-limited.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENDPOINT = process.env.JEV_ENDPOINT || 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.JEV_MODEL || 'jev-latest';
const KEY_FILE = process.env.TYPESAFE_KEY_FILE || join(homedir(), '.config', 'typesafe', 'key');

/** The policy. Keep these in one reviewable place. */
const POLICY = {
  auto: Number(process.env.JEV_AUTO_THRESHOLD || 0.8),
  review: Number(process.env.JEV_REVIEW_THRESHOLD || 0.5),
};

const QUESTIONS = {
  dept: {
    type: 'choice',
    instructions: 'Which team should handle this',
    criteria: {
      billing: 'payment, invoice or subscription problems',
      technical: 'bugs, outages or integration problems',
      sales: 'pricing, plans or new business',
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pace calls between samples so the provider's rate limits are not hit. */
const SAMPLE_DELAY_MS = Number(process.env.JEV_SAMPLE_DELAY_MS || 4000);

/** Load the TypeSafe key from the configured key file. */
async function apiKey() {
  const key = (await readFile(KEY_FILE, 'utf8')).trim();
  if (key === '') throw new Error('empty key file: ' + KEY_FILE);
  return key;
}

/**
 * One Jev call: state plus typed questions, structured answers back.
 * Retries 429 (provider rate limit) and 5xx with exponential backoff.
 * @param {string} state - the shared state to judge.
 * @param {object} questions - typed question map.
 * @returns {Promise<object>} the provider response body.
 */
async function decide(state, questions) {
  const key = await apiKey();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + key,
      },
      body: JSON.stringify({ state, questions, model: MODEL }),
    });
    const body = await response.json();
    if (response.ok) return body;
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const waitMs = 8000 * Math.pow(2, attempt - 1);
      console.log('   [' + response.status + '] provider is rate-limiting or upstream is busy, retrying in ' + (waitMs / 1000) + 's (attempt ' + attempt + '/3)');
      await sleep(waitMs);
      continue;
    }
    if (response.status === 429) {
      throw new Error('Jev call failed: HTTP 429 (the provider is rate-limiting this key): ' + JSON.stringify(body));
    }
    throw new Error('Jev call failed: HTTP ' + response.status + ' ' + JSON.stringify(body));
  }
  throw new Error('Jev call failed: retries exhausted');
}

/**
 * Read the calibrated confidence for one answer. The official API reports it on the
 * answer itself, as answers[key].confidence. A yes/no answer carries no confidence
 * field: its noul value is the probability that the answer is yes.
 * @param {object} body - provider response body.
 * @param {string} key - question key.
 * @returns {number} confidence (or yes-probability) in [0, 1].
 */
function confidenceOf(body, key) {
  const answer = (body.answers || {})[key] || {};
  if (typeof answer.confidence === 'number') return answer.confidence;
  if (typeof answer.noul === 'number') return answer.noul;
  const values = Object.values(answer.probabilities || {});
  if (values.length > 0) return Math.max.apply(null, values);
  return 0;
}

/**
 * Map a confidence onto the three lanes.
 * @param {number} confidence - calibrated confidence.
 * @returns {'auto'|'review'|'human'} the chosen lane.
 */
function lane(confidence) {
  if (confidence >= POLICY.auto) return 'auto';
  if (confidence >= POLICY.review) return 'review';
  return 'human';
}

/** Route one state and print the decision. */
async function routeOne(state) {
  const body = await decide(state, QUESTIONS);
  const answer = body.answers.dept;
  const confidence = confidenceOf(body, 'dept');
  const chosen = lane(confidence);
  const hasCalibrated = typeof answer.confidence === 'number';
  console.log('state      : ' + state.slice(0, 72));
  console.log('choice     : ' + answer.choice + '  probabilities=' + JSON.stringify(answer.probabilities));
  console.log('confidence : ' + confidence.toFixed(2) + (hasCalibrated ? '  (answers.dept.confidence)' : '  (fallback: top probability)'));
  console.log('lane       : ' + chosen + (chosen === 'auto'
    ? '  -> execute: ' + answer.choice
    : chosen === 'review'
      ? '  -> escalate: ask a frontier model or re-ask Jev with sharper criteria'
      : '  -> human queue, attach the state'));
  console.log('');
  return { state, answer: answer.choice, confidence };
}

/** Sweep thresholds over the built-in labelled fixture and print accuracy/coverage. */
async function calibrate() {
  const fixture = [
    { state: 'My card was charged twice for one order. Please refund the extra charge.', truth: 'billing' },
    { state: 'The dashboard throws a 500 whenever I open the reports page.', truth: 'technical' },
    { state: 'Can I get a quote for 200 seats on the enterprise plan?', truth: 'sales' },
    { state: 'Login is fine but the export button does nothing since this morning.', truth: 'technical' },
    { state: 'I want to downgrade before the next invoice lands.', truth: 'billing' },
  ];
  const limit = Number(process.env.JEV_CALIBRATE_LIMIT || 0);
  const samples = limit > 0 ? fixture.slice(0, limit) : fixture;
  const rows = [];
  for (let index = 0; index < samples.length; index += 1) {
    const item = samples[index];
    if (index > 0) await sleep(SAMPLE_DELAY_MS);
    const body = await decide(item.state, QUESTIONS);
    rows.push({
      truth: item.truth,
      answer: body.answers.dept.choice,
      confidence: confidenceOf(body, 'dept'),
    });
  }
  console.log('per-sample results (Jev confidence in brackets):');
  for (const row of rows) {
    const ok = row.answer === row.truth ? 'ok  ' : 'MISS';
    console.log('  ' + ok + ' expected ' + row.truth + ', got ' + row.answer + ' (' + row.confidence.toFixed(2) + ')');
  }
  console.log('');
  console.log('threshold  auto-lane accuracy  auto-lane coverage');
  for (const threshold of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    const laneRows = rows.filter((row) => row.confidence >= threshold);
    const correct = laneRows.filter((row) => row.answer === row.truth).length;
    const accuracy = laneRows.length === 0 ? ' n/a' : (correct / laneRows.length).toFixed(2);
    const coverage = ((laneRows.length / rows.length) * 100).toFixed(0) + '%';
    console.log('   ' + threshold.toFixed(2) + '          ' + accuracy + '                ' + coverage);
  }
  console.log('');
  console.log('Pick the lowest threshold whose accuracy clears your risk bar: that is your auto lane.');
  console.log('Five samples are illustrative only; calibrate on real labelled data from your workload.');
}

const args = process.argv.slice(2);
if (args[0] === '--calibrate') {
  await calibrate();
} else if (args.length > 0) {
  await routeOne(args.join(' '));
} else {
  await routeOne('My card was charged twice for one order. Please refund the extra charge.');
  await sleep(SAMPLE_DELAY_MS);
  await routeOne('Something is broken but I cannot tell you what, it just feels off lately.');
  console.log('policy: auto >= ' + POLICY.auto + ', review >= ' + POLICY.review + ' (override with JEV_AUTO_THRESHOLD / JEV_REVIEW_THRESHOLD)');
}
