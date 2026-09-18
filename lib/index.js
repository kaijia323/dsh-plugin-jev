/**
 * DSH tool plugin exposing TypeSafe's Jev System One model as a native tool.
 *
 * Jev is a decision model: it takes state plus typed questions and returns
 * typed answers with calibrated confidences. It cannot produce prose, so this
 * plugin registers a tool instead of a chat provider.
 *
 * Two transports reach the same model:
 *   typesafe - the native TypeSafe API: POST {baseURL}/v1/systemone (default)
 *   vercel   - Vercel AI Gateway: POST {gatewayBaseURL}/evaluation-model,
 *              model id such as typesafe-ai/jev, key from Vercel (no TypeSafe
 *              invite required). The gateway is evaluation-only: Jev is not on
 *              the OpenAI-compatible endpoints.
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

/** Question types accepted on the wire, per transport. */
const TYPESAFE_QUESTION_TYPES = new Set(['choice', 'score', 'noul']);
const GATEWAY_QUESTION_TYPES = new Set(['choice', 'score', 'boolean']);

const DEFAULTS = {
  transport: 'typesafe',
  baseURL: 'https://api.typesafe.ai',
  model: 'jev-latest',
  apiKeyEnv: undefined,
  keyFile: join(homedir(), '.config', 'typesafe', 'key'),
  vercelKeyFile: join(homedir(), '.config', 'vercel', 'ai-gateway-key'),
  timeoutMs: 60000,
  // toolTimeoutMs has no constant default: it derives from timeoutMs and
  // retries in normalizeConfig so the tool budget covers every attempt.
  retries: 0,
  maxStateBytes: 262144,
  maxQuestions: 64,
  gatewayBaseURL: 'https://ai-gateway.vercel.sh/v4/ai',
  gatewayProtocolVersion: '0.0.1',
  gatewayModel: 'typesafe-ai/jev',
  gatewaySpecVersion: '4',
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
 * Normalize the plugin config: defaults, transport selection, endpoint
 * validation, and a trailing-slash strip so request paths compose once.
 * @param config - raw entry config, possibly empty.
 * @returns the resolved config.
 */
function normalizeConfig(config) {
  const raw = config === undefined || config === null ? {} : config;
  const transport = String(raw.transport === undefined ? DEFAULTS.transport : raw.transport);
  if (transport !== 'typesafe' && transport !== 'vercel') {
    throw new Error('tool-jev: transport must be "typesafe" or "vercel"');
  }
  const timeoutMs = positiveNumber(raw.timeoutMs, DEFAULTS.timeoutMs, 'timeoutMs');
  const retries = nonNegativeInteger(raw.retries, DEFAULTS.retries, 'retries');
  const isVercel = transport === 'vercel';
  const defaultModel = isVercel ? DEFAULTS.gatewayModel : DEFAULTS.model;
  const defaultKeyEnv = isVercel ? 'AI_GATEWAY_API_KEY' : 'TYPESAFE_API_KEY';
  return {
    transport,
    baseURL: endpoint(raw.baseURL === undefined ? DEFAULTS.baseURL : raw.baseURL, 'baseURL'),
    gatewayBaseURL: endpoint(
      raw.gatewayBaseURL === undefined ? DEFAULTS.gatewayBaseURL : raw.gatewayBaseURL,
      'gatewayBaseURL',
    ),
    gatewayProtocolVersion: String(
      raw.gatewayProtocolVersion === undefined ? DEFAULTS.gatewayProtocolVersion : raw.gatewayProtocolVersion,
    ),
    gatewaySpecVersion: String(
      raw.gatewaySpecVersion === undefined ? DEFAULTS.gatewaySpecVersion : raw.gatewaySpecVersion,
    ),
    model: String(raw.model === undefined ? defaultModel : raw.model),
    apiKeyEnv: String(raw.apiKeyEnv === undefined ? defaultKeyEnv : raw.apiKeyEnv),
    keyFile: String(
      raw.keyFile === undefined ? (isVercel ? DEFAULTS.vercelKeyFile : DEFAULTS.keyFile) : raw.keyFile,
    ),
    timeoutMs,
    retries,
    toolTimeoutMs:
      raw.toolTimeoutMs === undefined
        ? positiveNumber(undefined, timeoutMs * (retries + 1) + 5000, 'toolTimeoutMs')
        : positiveNumber(raw.toolTimeoutMs, timeoutMs * (retries + 1) + 5000, 'toolTimeoutMs'),
    maxStateBytes: positiveNumber(raw.maxStateBytes, DEFAULTS.maxStateBytes, 'maxStateBytes'),
    maxQuestions: positiveNumber(raw.maxQuestions, DEFAULTS.maxQuestions, 'maxQuestions'),
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
 * configured apiKeyEnv first, then the transport's conventional names.
 * Duplicates are dropped so diagnostics never repeat a variable, which happens
 * by default on the gateway (apiKeyEnv === AI_GATEWAY_API_KEY).
 * @param config - resolved plugin config.
 * @returns de-duplicated env var names in lookup order.
 */
function keyEnvNames(config) {
  const names =
    config.transport === 'vercel'
      ? [config.apiKeyEnv, 'AI_GATEWAY_API_KEY', 'VERCEL_AI_GATEWAY_API_KEY']
      : [config.apiKeyEnv, 'JEV_API_KEY'];
  return Array.from(new Set(names));
}

/**
 * Resolve the API key from the configured env var, then the transport's
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
  const hint =
    config.transport === 'vercel'
      ? ' Create an AI Gateway key at https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fai-gateway%2Fapi-keys'
      : '';
  const names = keyEnvNames(config)
    .map((name) => '$' + name)
    .join(' or ');
  return 'tool-jev: no API key. Set ' + names + ', or write the key to ' + config.keyFile + '.' + hint;
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
 * translate it to the transport's question vocabulary (the gateway spells the
 * yes/no primitive "boolean"; TypeSafe spells it "noul").
 * @param questions - raw questions argument.
 * @param config - resolved plugin config.
 * @returns the wire questions object.
 */
function assertQuestions(questions, config) {
  if (questions === null || typeof questions !== 'object' || Array.isArray(questions)) {
    throw new Error('tool-jev: questions must be an object mapping a key to { type, instructions, criteria? }');
  }
  const allowed = config.transport === 'vercel' ? GATEWAY_QUESTION_TYPES : TYPESAFE_QUESTION_TYPES;
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
    if (config.transport === 'vercel' && type === 'noul') type = 'boolean';
    if (config.transport === 'typesafe' && type === 'boolean') type = 'noul';
    if (!allowed.has(type)) {
      throw new Error(
        'tool-jev: questions.' + key + '.type must be one of ' + Array.from(allowed).join(' | '),
      );
    }
    if (typeof spec.instructions !== 'string' || spec.instructions.trim() === '') {
      throw new Error('tool-jev: questions.' + key + '.instructions must be a non-empty string');
    }
    if (type !== 'noul' && type !== 'boolean') {
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
    const translated = { type, instructions: spec.instructions };
    if (spec.criteria !== undefined) translated.criteria = spec.criteria;
    wire[key] = translated;
  }
  return wire;
}

/**
 * Build the request for the configured transport.
 * @param args - model-supplied arguments.
 * @param questions - translated wire questions.
 * @param config - resolved plugin config.
 * @returns the URL, headers, and body to send.
 */
function buildRequest(args, questions, config) {
  const model = typeof args.model === 'string' && args.model.trim() !== '' ? args.model.trim() : config.model;
  if (config.transport === 'vercel') {
    return {
      url: config.gatewayBaseURL + '/evaluation-model',
      headers: {
        'content-type': 'application/json',
        'ai-gateway-protocol-version': config.gatewayProtocolVersion,
        'ai-evaluation-model-specification-version': config.gatewaySpecVersion,
        'ai-model-id': model,
      },
      body: { state: args.state, questions },
      model,
    };
  }
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
    ' This model\'s free-tier quota on the AI Gateway is rate-limited (HTTP 429): wait a moment and retry.' +
    ' If it keeps failing, the free tier for this model is exhausted and a paid AI Gateway allowance is required.'
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
 * How the yes/no primitive comes back on the wire, per transport. The gateway
 * returns { type: "boolean", probability } and has no .noul field, no
 * .boolean field, and no confidence entry for it; native TypeSafe returns
 * .noul. Model-facing text must match reality or callers read undefined.
 * @param transport - resolved transport.
 * @returns the reply clause for the description.
 */
function replyGrammar(transport) {
  if (transport === 'vercel') {
    return (
      'Replies on this Vercel AI Gateway transport: choice gives answers[key].choice plus probabilities;' +
      ' score gives answers[key].score plus a legend or probabilities;' +
      ' the yes/no primitive is boolean here, so its answer is answers[key] = { type: "boolean", probability: 0.83 }' +
      ' - read answers[key].probability (the probability that the answer is yes); that entry has no .noul field,' +
      ' no .boolean field, and no confidence entry.'
    );
  }
  return (
    'Replies on this native TypeSafe transport: choice gives answers[key].choice plus probabilities;' +
    ' score gives answers[key].score plus a legend or probabilities;' +
    ' the yes/no primitive is noul here, so read answers[key].noul, the probability that the answer is yes.'
  );
}

/**
 * Model-facing tool description, including the question grammar and the reply
 * shape for the configured transport.
 * @param transport - resolved transport.
 * @returns the description text.
 */
function describeTool(transport) {
  return [
    'Ask TypeSafe Jev, a System One decision model, for typed judgments about arbitrary state.',
    'Jev never writes prose: every question returns a typed answer plus a calibrated confidence, so use it for routing, classification, rubric scoring, and yes/no checks where the answer space is known in advance.',
    'One call sends one state (text or JSON) plus a questions object; all questions are evaluated in a single pass.',
    'Question grammar: choice needs { type: "choice", instructions: "...", criteria: { "option_key": "meaning" } };',
    'score needs { type: "score", instructions: "...", criteria: ["level 0 meaning", "level 1 meaning"] };',
    'the yes/no primitive is { type: "noul", instructions: "yes/no question" } or the equivalent { type: "boolean", ... }: either spelling is accepted and the transport translates it.',
    replyGrammar(transport),
    'Question keys are yours to choose, and choice/score criteria accept nested JSON structure.',
  ].join(' ');
}

/**
 * Raw JSON Schema for the parameters, in the enforced DSH subset. The
 * questions description restates the reply field to read for the configured
 * transport, matching {@link describeTool}.
 * @param transport - resolved transport.
 * @returns the parameters schema.
 */
function parametersFor(transport) {
  const yesNoReply =
    transport === 'vercel'
      ? 'the gateway returns answers[key] = { type: "boolean", probability } for it, so read .probability (no .noul, no .boolean, no confidence).'
      : 'read answers[key].noul, the probability that the answer is yes.';
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
          ' choice answers carry .choice plus probabilities; score answers carry .score plus a legend or probabilities; for yes/no, ' +
          yesNoReply,
      },
      model: {
        type: 'string',
        description: 'Optional model id; defaults to the plugin-configured model (jev-latest, or typesafe-ai/jev on Vercel).',
      },
    },
  };
}

/**
 * Register the jev_decide tool.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - optional deployment config: transport, endpoint, model, key reference, timeouts.
 */
export function apply(ctx, config) {
  const resolved = normalizeConfig(config);
  ctx.tools.register({
    name: 'jev_decide',
    description: describeTool(resolved.transport),
    parameters: parametersFor(resolved.transport),
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
}
