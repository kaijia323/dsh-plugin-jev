/**
 * DSH tool plugin exposing TypeSafe's Jev System One model as a native tool.
 *
 * Jev is a decision model: it takes state plus typed questions and returns
 * typed answers with calibrated confidences. It cannot produce prose, so this
 * plugin registers a tool instead of a chat provider.
 *
 * One transport reaches the model: the official TypeSafe API at
 * POST {baseURL}/v1/systemone, authenticated with a Bearer TypeSafe API key.
 * A config that still names the retired transport fails loudly at
 * registration instead of silently falling back to the official endpoint.
 *
 * Dependency-free by design: it registers a raw JsonSchemaNode-shaped tool
 * definition through ctx.tools.register, the same registration path that
 * MCP-provided tools use.
 *
 * @module dsh-plugin-jev
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Cordis plugin name. */
export const name = 'tool-jev';

/** Services this plugin needs before it activates. */
export const inject = ['tools'];

/**
 * Canonical question types accepted on the wire: choice | score | noul.
 * `boolean` remains an accepted spelling of the yes/no primitive and is
 * normalized to `noul` before the request is built.
 */
const QUESTION_TYPES = new Set(['choice', 'score', 'noul']);

const DEFAULTS = {
  transport: 'typesafe',
  baseURL: 'https://api.typesafe.ai',
  model: 'jev-latest',
  apiKeyEnv: 'TYPESAFE_API_KEY',
  keyFile: join(homedir(), '.config', 'typesafe', 'key'),
  timeoutMs: 60000,
  // toolTimeoutMs has no constant default: it derives from timeoutMs and
  // retries in normalizeConfig so the tool budget covers every attempt.
  retries: 0,
  maxStateBytes: 262144,
  maxQuestions: 64,
};

/**
 * Resolve one positive finite numeric config field.
 * @param value - candidate value from the patch entry.
 * @param fallback - default used when the value is absent.
 * @param label - field name used in diagnostics.
 * @returns the resolved number.
 */
function positiveNumber(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('tool-jev: ' + label + ' must be a positive finite number');
  }
  return value;
}

/**
 * Resolve one non-negative integer config field. `0` is a meaningful value
 * here (retries: 0 means "never retry"), so positiveNumber would be wrong.
 * @param value - candidate value from the patch entry.
 * @param fallback - default used when the value is absent.
 * @param label - field name used in diagnostics.
 * @returns the resolved integer.
 */
function nonNegativeInteger(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('tool-jev: ' + label + ' must be a non-negative integer');
  }
  return value;
}

/**
 * Validate an http(s) endpoint root and strip trailing slashes.
 * @param value - candidate URL.
 * @param label - field name used in diagnostics.
 * @returns the normalized URL.
 */
function endpoint(value, label) {
  const url = String(value).replace(/[/]+$/, '');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('tool-jev: ' + label + ' is not a valid URL: ' + url);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('tool-jev: ' + label + ' must be http(s), got ' + parsed.protocol);
  }
  return url;
}

/**
 * Validate the optional policySection config, which drives the resident prompt
 * section (surface B). `order` stays undefined when the caller did not set one:
 * its default is derived from the systemPrompt service's central order table,
 * which only exists once apply() has a ctx, so that default is resolved lazily
 * at registration time. Every rejection is a hard `tool-jev:` error, matching
 * the rest of the config surface.
 * @param raw - raw policySection value, possibly absent.
 * @returns the resolved { enabled, order } pair; order may be undefined (lazy default).
 */
function normalizePolicySection(raw) {
  if (raw === undefined || raw === null) return { enabled: true, order: undefined };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('tool-jev: policySection must be an object with optional enabled and order fields');
  }
  const enabled = raw.enabled === undefined ? true : raw.enabled;
  if (typeof enabled !== 'boolean') {
    throw new Error('tool-jev: policySection.enabled must be a boolean');
  }
  let order;
  if (raw.order !== undefined && raw.order !== null) {
    if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) {
      throw new Error('tool-jev: policySection.order must be a finite number');
    }
    order = raw.order;
  }
  return { enabled, order };
}

/**
 * Normalize the plugin config: defaults, transport guard, endpoint
 * validation, and a trailing-slash strip so request paths compose once.
 *
 * `typesafe` is the only transport. Any other value - including the transport
 * retired in this release - is a hard error: silently calling the official
 * endpoint with a key minted elsewhere would fail far less legibly than
 * refusing to register.
 * @param config - raw entry config, possibly empty.
 * @returns the resolved config.
 */
function normalizeConfig(config) {
  const raw = config === undefined || config === null ? {} : config;
  const transport = String(raw.transport === undefined ? DEFAULTS.transport : raw.transport);
  if (transport !== 'typesafe') {
    throw new Error(
      'tool-jev: transport must be "typesafe": the Vercel AI Gateway transport was removed,' +
        ' so only transport "typesafe" (the official TypeSafe API) is supported (got "' + transport + '")',
    );
  }
  const timeoutMs = positiveNumber(raw.timeoutMs, DEFAULTS.timeoutMs, 'timeoutMs');
  const retries = nonNegativeInteger(raw.retries, DEFAULTS.retries, 'retries');
  return {
    transport,
    baseURL: endpoint(raw.baseURL === undefined ? DEFAULTS.baseURL : raw.baseURL, 'baseURL'),
    model: String(raw.model === undefined ? DEFAULTS.model : raw.model),
    apiKeyEnv: String(raw.apiKeyEnv === undefined ? DEFAULTS.apiKeyEnv : raw.apiKeyEnv),
    keyFile: String(raw.keyFile === undefined ? DEFAULTS.keyFile : raw.keyFile),
    timeoutMs,
    retries,
    toolTimeoutMs:
      raw.toolTimeoutMs === undefined
        ? positiveNumber(undefined, timeoutMs * (retries + 1) + 5000, 'toolTimeoutMs')
        : positiveNumber(raw.toolTimeoutMs, timeoutMs * (retries + 1) + 5000, 'toolTimeoutMs'),
    maxStateBytes: positiveNumber(raw.maxStateBytes, DEFAULTS.maxStateBytes, 'maxStateBytes'),
    maxQuestions: positiveNumber(raw.maxQuestions, DEFAULTS.maxQuestions, 'maxQuestions'),
    policySection: normalizePolicySection(raw.policySection),
  };
}

/**
 * Read a trimmed key file, tolerating a missing or empty file.
 * @param path - candidate key file path.
 * @returns the key, or undefined.
 */
async function readKeyFile(path) {
  try {
    const key = (await readFile(path, 'utf8')).trim();
    return key === '' ? undefined : key;
  } catch {
    return undefined;
  }
}

/**
 * The environment variables consulted for the API key, in lookup order: the
 * configured apiKeyEnv first, then the official API's conventional fallback.
 * Duplicates are dropped so diagnostics never repeat a variable; that happens
 * whenever apiKeyEnv is JEV_API_KEY, the fallback itself.
 * @param config - resolved plugin config.
 * @returns de-duplicated env var names in lookup order.
 */
function keyEnvNames(config) {
  return Array.from(new Set([config.apiKeyEnv, 'JEV_API_KEY']));
}

/**
 * Resolve the API key from the configured env var, then the official API's
 * conventional env var, then the key file. The key never travels through tool
 * arguments, so it cannot land in the model transcript.
 * @param config - resolved plugin config.
 * @returns the API key, or undefined when nothing is configured.
 */
async function resolveApiKey(config) {
  for (const name of keyEnvNames(config)) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return readKeyFile(config.keyFile);
}

/**
 * Build the "no API key" diagnostic listing every consulted source exactly
 * once, in the same order the resolver uses.
 * @param config - resolved plugin config.
 * @returns the error message.
 */
function missingKeyMessage(config) {
  const names = keyEnvNames(config)
    .map((name) => '$' + name)
    .join(' or ');
  return 'tool-jev: no API key. Set ' + names + ', or write the key to ' + config.keyFile + '.';
}

/**
 * Describe a rejected value's shape for an error message, without echoing
 * potentially large payloads.
 * @param value - the rejected value.
 * @returns a short shape label.
 */
function describeShape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? 'an empty array' : 'an array';
  const type = typeof value;
  if (type === 'object') return Object.keys(value).length === 0 ? 'an empty object' : 'an object';
  if (type === 'string') return 'a string';
  return 'a ' + type;
}

/**
 * Validate the model-supplied question map before spending a request, and
 * normalize it to the wire vocabulary (choice | score | noul). The accepted
 * `boolean` spelling of the yes/no primitive becomes `noul` here.
 * @param questions - raw questions argument.
 * @param config - resolved plugin config.
 * @returns the wire questions object.
 */
function assertQuestions(questions, config) {
  if (questions === null || typeof questions !== 'object' || Array.isArray(questions)) {
    throw new Error('tool-jev: questions must be an object mapping a key to { type, instructions, criteria? }');
  }
  const allowed = QUESTION_TYPES;
  const keys = Object.keys(questions);
  if (keys.length === 0) throw new Error('tool-jev: questions must declare at least one question');
  if (keys.length > config.maxQuestions) {
    throw new Error('tool-jev: at most ' + config.maxQuestions + ' questions per call (got ' + keys.length + ')');
  }
  const wire = {};
  for (const key of keys) {
    const spec = questions[key];
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new Error('tool-jev: questions.' + key + ' must be an object');
    }
    let type = spec.type;
    if (type === 'boolean') type = 'noul';
    if (!allowed.has(type)) {
      throw new Error('tool-jev: questions.' + key + '.type must be one of choice | score | noul');
    }
    if (typeof spec.instructions !== 'string' || spec.instructions.trim() === '') {
      throw new Error('tool-jev: questions.' + key + '.instructions must be a non-empty string');
    }
    if (type !== 'noul') {
      if (spec.criteria === undefined) {
        throw new Error('tool-jev: questions.' + key + '.criteria is required for a ' + type + ' question');
      }
      if (type === 'choice') {
        const isObject =
          spec.criteria !== null && typeof spec.criteria === 'object' && !Array.isArray(spec.criteria);
        if (!isObject || Object.keys(spec.criteria).length === 0) {
          throw new Error(
            'tool-jev: questions.' +
              key +
              '.criteria must be a non-empty object mapping option_key to meaning for a choice question (got ' +
              describeShape(spec.criteria) +
              ')',
          );
        }
      } else if (!Array.isArray(spec.criteria) || spec.criteria.length === 0) {
        throw new Error(
          'tool-jev: questions.' +
            key +
            '.criteria must be a non-empty array of level meanings for a score question (got ' +
            describeShape(spec.criteria) +
            ')',
        );
      }
    }
    const normalized = { type, instructions: spec.instructions };
    if (spec.criteria !== undefined) normalized.criteria = spec.criteria;
    wire[key] = normalized;
  }
  return wire;
}

/**
 * Build the request for the official TypeSafe API.
 * @param args - model-supplied arguments.
 * @param questions - normalized wire questions.
 * @param config - resolved plugin config.
 * @returns the URL, headers, and body to send.
 */
function buildRequest(args, questions, config) {
  const model = typeof args.model === 'string' && args.model.trim() !== '' ? args.model.trim() : config.model;
  return {
    url: config.baseURL + '/v1/systemone',
    headers: { 'content-type': 'application/json' },
    body: { state: args.state, questions, model },
    model,
  };
}

/**
 * Whether the caller (harness) cancelled the run. Checked before every attempt
 * and again after a failure, so a caller cancellation is never retried and
 * never misreported as a provider timeout.
 * @param exec - harness tool run context.
 * @returns whether exec.signal is aborted.
 */
function isCallerAborted(exec) {
  return exec?.signal?.aborted === true;
}

/**
 * Build the caller-cancellation error. The name is AbortError so harness
 * callers can classify it, and the message stays distinct from a timeout.
 * @returns the error to throw.
 */
function callerAbortError() {
  const error = new Error('tool-jev: call aborted by the caller');
  error.name = 'AbortError';
  return error;
}

/** Wait for one retry backoff. @param ms - milliseconds to wait. @returns a promise. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Append an actionable hint to a 429 failure. The provider's original body
 * snippet is preserved ahead of the hint.
 * @param status - the HTTP status (only 429 gets the hint).
 * @returns the hint text, or an empty string.
 */
function rateLimitHint(status) {
  if (status !== 429) return '';
  return (
    ' The provider is rate-limiting this key (HTTP 429): wait a moment and retry.' +
    ' If it keeps failing, the key is over its quota and needs a higher limit.'
  );
}

/**
 * Send one request attempt with a fresh timeout signal. Never reuses an
 * AbortSignal across attempts, so a timeout in attempt N cannot poison N+1.
 * @param request - URL, headers, body, and model from buildRequest.
 * @param headers - request headers including authorization.
 * @param body - the serialized request body.
 * @param exec - harness tool run context (carries the cancellation signal).
 * @param config - resolved plugin config.
 * @returns the provider response body.
 */
async function attemptRequest(request, headers, body, exec, config) {
  const signals = [AbortSignal.timeout(config.timeoutMs)];
  if (exec !== undefined && exec !== null && exec.signal) signals.push(exec.signal);

  let response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.any(signals),
    });
  } catch (error) {
    if (isCallerAborted(exec)) throw callerAbortError();
    const errorName = error instanceof Error ? error.name : '';
    if (errorName === 'TimeoutError' || errorName === 'AbortError') {
      const timeout = new Error('tool-jev: request to ' + request.url + ' timed out after ' + config.timeoutMs + ' ms');
      timeout.retryable = true;
      throw timeout;
    }
    const message = error instanceof Error ? error.message : String(error);
    const network = new Error('tool-jev: request to ' + request.url + ' failed: ' + message);
    network.retryable = true;
    throw network;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const httpError = new Error(
      'tool-jev: ' +
        request.model +
        ' returned HTTP ' +
        response.status +
        (detail ? ': ' + detail.slice(0, 500) : '') +
        rateLimitHint(response.status),
    );
    httpError.retryable = response.status >= 500;
    throw httpError;
  }

  const data = await response.json();
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      'tool-jev: the endpoint response must be an object with an "answers" property, got ' + describeShape(data),
    );
  }
  if (data.answers === null || typeof data.answers !== 'object' || Array.isArray(data.answers)) {
    throw new Error(
      'tool-jev: the endpoint response is missing the required "answers" object (answers must be an object)',
    );
  }
  return data;
}

/**
 * Call the configured endpoint, retrying transient failures (timeout, network,
 * 5xx) up to config.retries times. 4xx responses, including 429, are never
 * retried; caller cancellation is never retried. After the attempts are
 * exhausted the last error is rethrown unchanged, keeping its URL and status.
 * @param args - model-supplied arguments.
 * @param exec - harness tool run context (carries the cancellation signal).
 * @param config - resolved plugin config.
 * @returns the provider response body.
 */
async function requestSystemOne(args, exec, config) {
  const state = args.state;
  if (typeof state !== 'string' || state.trim() === '') {
    throw new Error('tool-jev: state must be a non-empty string');
  }
  const stateBytes = Buffer.byteLength(state, 'utf8');
  if (stateBytes > config.maxStateBytes) {
    throw new Error('tool-jev: state is ' + stateBytes + ' bytes, over maxStateBytes ' + config.maxStateBytes);
  }
  const questions = assertQuestions(args.questions, config);

  const apiKey = await resolveApiKey(config);
  if (apiKey === undefined) throw new Error(missingKeyMessage(config));

  const request = buildRequest(args, questions, config);
  const headers = { ...request.headers, authorization: 'Bearer ' + apiKey };
  const body = JSON.stringify(request.body);

  if (isCallerAborted(exec)) throw callerAbortError();

  const attempts = config.retries + 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(500 * (attempt - 1));
    if (isCallerAborted(exec)) throw callerAbortError();
    try {
      return await attemptRequest(request, headers, body, exec, config);
    } catch (error) {
      if (isCallerAborted(exec)) throw callerAbortError();
      lastError = error;
      const retryable = error instanceof Error && error.retryable === true;
      if (!retryable || attempt >= attempts) break;
    }
  }
  throw lastError;
}

/**
 * The one shared trigger-policy vocabulary. Both model-facing surfaces assemble
 * their prose from these exact fragments: the jev_decide tool description
 * (surface A: native tool list, or a generated SDK JSDoc under PTC) and the
 * resident `jev-decision-policy` prompt section (surface B: every session of the
 * profile). Keeping one source of truth is what stops the two from drifting.
 *
 * The block order is deliberate: purpose, default-on rule, the four exemptions,
 * the seven decision moments, the budget. Anchor wording is asserted verbatim by
 * the test suite; do not reflow it.
 */
const POLICY = {
  purpose: 'Ask TypeSafe Jev, a System One decision model, for typed judgments about arbitrary state.',
  whenToUse: 'When to use: call jev_decide whenever the answer is a judgment, not a lookup.',
  defaultRule:
    'Default: ask Jev before turning a judgment about meaning, intent, relevance, fit, or risk into a conclusion.',
  exemptions:
    "Exempt only when the answer is fixed by an explicit instruction, a mechanical check, readable file or command output, or the caller's own decision.",
  moments:
    'Decision moments: two self-consistent options; meaning, intent, or relevance; classifying or routing; rubric scoring; a calibrated yes/no; a long or ambiguous state; an irreversible next step.',
  budget: 'Budget: one call carries one state plus every question about it; keep criteria concrete.',
  grammar:
    'Question grammar: choice needs { type: "choice", instructions: "...", criteria: { "option_key": "meaning" } };',
  scoreGrammar:
    'score needs { type: "score", instructions: "...", criteria: ["level 0 meaning", "level 1 meaning"] };',
  noulGrammar:
    'the yes/no primitive is { type: "noul", instructions: "yes/no question" }, with { type: "boolean" } as an accepted alias normalized to noul on the wire.',
  replies: [
    'Replies: choice gives answers[key].choice plus probabilities and a calibrated confidence;',
    'score gives answers[key].score plus a legend or probabilities and a calibrated confidence;',
    'the yes/no primitive is noul, so read answers[key].noul, the probability that the answer is yes.',
    'Question keys are yours to choose, and choice/score criteria accept nested JSON structure.',
  ].join(' '),
};

/**
 * The policy block shared verbatim by the tool description and the prompt
 * section: default-on rule, four exemptions, seven decision moments, budget.
 * @returns the joined policy block.
 */
function policyBlock() {
  return [POLICY.whenToUse, POLICY.defaultRule, POLICY.exemptions, POLICY.moments, POLICY.budget].join(' ');
}

/**
 * Text of the resident prompt section (surface B): the shared policy block plus
 * the two fragments only the section needs - what the tool returns, and how it
 * is reached under PTC. Synchronous by construction: a prompt provider must not
 * perform network calls, and this one never does.
 * @returns the section text, starting with the kebab-case section heading.
 */
function policySectionText() {
  return [
    '## Jev decision policy',
    'Use jev_decide for typed judgments: it returns a typed answer plus a calibrated confidence, never prose.',
    policyBlock(),
    'In PTC mode call jev_decide from inside a run_code program, not as a top-level tool call.',
  ].join('\n\n');
}

/**
 * Model-facing tool description: the policy block first, then the question
 * grammar and the reply shape of the official TypeSafe API. The reply text must
 * match the wire exactly, or callers read undefined.
 * @returns the description text.
 */
function describeTool() {
  return [
    POLICY.purpose,
    policyBlock(),
    POLICY.grammar,
    POLICY.scoreGrammar,
    POLICY.noulGrammar,
    POLICY.replies,
  ].join(' ');
}

/**
 * Raw JSON Schema for the parameters, in the enforced DSH subset. The
 * questions description restates the same reply fields as {@link describeTool}.
 * @returns the parameters schema.
 */
function parametersFor() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['state', 'questions'],
    properties: {
      state: {
        type: 'string',
        description: 'The state to judge: raw text, JSON, a log excerpt, a support ticket, a diff, and so on.',
      },
      questions: {
        type: 'object',
        description:
          'Map of question key to { type: "choice" | "score" | "noul" | "boolean", instructions: string, criteria?: object | array }.' +
          ' criteria is required for choice (a non-empty object of option_key -> meaning) and for score (a non-empty array of level meanings).' +
          ' choice answers carry .choice plus probabilities and a confidence; score answers carry .score plus a legend or probabilities' +
          ' and a confidence; for yes/no, read answers[key].noul, the probability that the answer is yes.',
      },
      model: {
        type: 'string',
        description: 'Optional model id; defaults to the plugin-configured model (jev-latest).',
      },
    },
  };
}

/**
 * Record a non-fatal policy diagnostic without letting diagnostics break
 * registration. Surface B is optional, so a placement problem must never
 * surface as a plugin activation error.
 * @param ctx - registrant context, when it exposes a logger.
 * @param message - the diagnostic text.
 */
function noteDiagnostic(ctx, message) {
  try {
    if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(message);
  } catch {
    // Diagnostics never break registration.
  }
}

/**
 * Resolve the default section placement: MCP_SERVERS + 10, or the constant 3110
 * when the service cannot answer - the value MCP_SERVERS resolves to in the
 * current central order table. A throw or a non-finite value is recorded as a
 * diagnostic and never escapes apply().
 * @param prompt - the systemPrompt service reached through the optional inject.
 * @param ctx - registrant context, for diagnostics only.
 * @returns the section order.
 */
function defaultSectionOrder(prompt, ctx) {
  try {
    const base = prompt.getSectionOrder('MCP_SERVERS');
    if (typeof base === 'number' && Number.isFinite(base)) return base + 10;
    noteDiagnostic(
      ctx,
      'tool-jev: systemPrompt.getSectionOrder("MCP_SERVERS") returned a non-finite value; using fallback order 3110',
    );
  } catch {
    noteDiagnostic(ctx, 'tool-jev: systemPrompt.getSectionOrder("MCP_SERVERS") failed; using fallback order 3110');
  }
  return 3110;
}

/**
 * Register the resident `jev-decision-policy` prompt section (surface B) through
 * the official optional-dependency idiom. The top-level inject list stays
 * ['tools']: systemPrompt is deliberately NOT a hard dependency, so a profile
 * without the service still activates and registers the tool. The callback runs
 * only once the service exists, and the registration is an effect of this fiber,
 * so it disposes with the plugin.
 * @param ctx - registrant context.
 * @param resolved - resolved plugin config carrying policySection.enabled/order.
 */
function registerPolicySection(ctx, resolved) {
  if (typeof ctx?.inject !== 'function') return;
  try {
    ctx.inject(['systemPrompt'], (inner) => {
      const prompt = inner?.systemPrompt ?? ctx.systemPrompt;
      if (prompt === undefined || prompt === null || typeof prompt.section !== 'function') return;
      prompt.section({
        name: 'jev-decision-policy',
        interpolate: false,
        order:
          resolved.policySection.order === undefined
            ? defaultSectionOrder(prompt, ctx)
            : resolved.policySection.order,
        text: policySectionText(),
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    noteDiagnostic(ctx, 'tool-jev: policy section registration failed: ' + message);
  }
}

/**
 * Register the jev_decide tool, then the optional policy section. The tool is
 * registered first so surface A can never be blocked by a failure on the
 * optional prompt surface.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - optional deployment config: transport, endpoint, model, key reference, timeouts, policySection.
 */
export function apply(ctx, config) {
  const resolved = normalizeConfig(config);
  ctx.tools.register({
    name: 'jev_decide',
    description: describeTool(),
    parameters: parametersFor(),
    timeoutMs: resolved.toolTimeoutMs,
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object',
        required: ['answers'],
        properties: {
          answers: {
            type: 'object',
            description: 'Answers keyed by question key, one entry per requested question.',
          },
        },
        description: 'The provider response: answers keyed by question, plus usage when the provider reports it.',
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: (args, exec) => requestSystemOne(args, exec, resolved),
  });
  if (resolved.policySection.enabled) registerPolicySection(ctx, resolved);
}
