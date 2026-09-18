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
  toolTimeoutMs: 65000,
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
    toolTimeoutMs:
      raw.toolTimeoutMs === undefined
        ? positiveNumber(undefined, timeoutMs + 5000, 'toolTimeoutMs')
        : positiveNumber(raw.toolTimeoutMs, timeoutMs + 5000, 'toolTimeoutMs'),
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
 * Resolve the API key from the configured env var, then the transport's
 * conventional env var, then the key file. The key never travels through tool
 * arguments, so it cannot land in the model transcript.
 * @param config - resolved plugin config.
 * @returns the API key, or undefined when nothing is configured.
 */
async function resolveApiKey(config) {
  const fromConfiguredEnv = process.env[config.apiKeyEnv];
  if (typeof fromConfiguredEnv === 'string' && fromConfiguredEnv.trim() !== '') {
    return fromConfiguredEnv.trim();
  }
  const fallbacks = config.transport === 'vercel' ? ['AI_GATEWAY_API_KEY', 'VERCEL_AI_GATEWAY_API_KEY'] : ['JEV_API_KEY'];
  for (const name of fallbacks) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return readKeyFile(config.keyFile);
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
    if (type !== 'noul' && type !== 'boolean' && spec.criteria === undefined) {
      throw new Error('tool-jev: questions.' + key + '.criteria is required for a ' + type + ' question');
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
 * Call the configured endpoint once, honoring the caller signal and a request
 * timeout.
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
  if (apiKey === undefined) {
    const hint =
      config.transport === 'vercel'
        ? ' Create an AI Gateway key at https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fai-gateway%2Fapi-keys'
        : '';
    throw new Error(
      'tool-jev: no API key. Set $' +
        config.apiKeyEnv +
        (config.transport === 'vercel' ? ' (or $AI_GATEWAY_API_KEY)' : ' or $JEV_API_KEY') +
        ', or write the key to ' +
        config.keyFile +
        '.' +
        hint,
    );
  }

  const request = buildRequest(args, questions, config);
  const headers = { ...request.headers, authorization: 'Bearer ' + apiKey };
  const signals = [AbortSignal.timeout(config.timeoutMs)];
  if (exec !== undefined && exec !== null && exec.signal) signals.push(exec.signal);

  let response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.any(signals),
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : '';
    if (errorName === 'TimeoutError' || errorName === 'AbortError') {
      throw new Error('tool-jev: request to ' + request.url + ' timed out after ' + config.timeoutMs + ' ms');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error('tool-jev: request to ' + request.url + ' failed: ' + message);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      'tool-jev: ' + request.model + ' returned HTTP ' + response.status + (detail ? ': ' + detail.slice(0, 500) : ''),
    );
  }

  const data = await response.json();
  if (data === null || typeof data !== 'object') {
    throw new Error('tool-jev: the endpoint returned a non-object body');
  }
  return data;
}

/** Model-facing tool description, including the question grammar. */
const DESCRIPTION = [
  'Ask TypeSafe Jev, a System One decision model, for typed judgments about arbitrary state.',
  'Jev never writes prose: every question returns a typed answer plus a calibrated confidence, so use it for routing, classification, rubric scoring, and yes/no checks where the answer space is known in advance.',
  'One call sends one state (text or JSON) plus a questions object; all questions are evaluated in a single pass.',
  'Question grammar: choice needs { type: "choice", instructions: "...", criteria: { "option_key": "meaning" } } and returns answers[key].choice plus probabilities;',
  'score needs { type: "score", instructions: "...", criteria: ["level 0 meaning", "level 1 meaning"] } and returns answers[key].score plus a legend or probabilities;',
  'noul needs { type: "noul", instructions: "yes/no question" } and returns answers[key].noul, the probability that the answer is yes.',
  'The yes/no primitive accepts either spelling: noul (native TypeSafe API) or boolean (Vercel AI Gateway), and the transport translates it.',
  'Question keys are yours to choose, and choice/score criteria accept nested JSON structure.',
].join(' ');

/** Raw JSON Schema for the parameters, in the enforced DSH subset. */
const PARAMETERS = {
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
        'Map of question key to { type: "choice" | "score" | "noul" | "boolean", instructions: string, criteria?: object | array }. criteria is required for choice and score.',
    },
    model: {
      type: 'string',
      description: 'Optional model id; defaults to the plugin-configured model (jev-latest, or typesafe-ai/jev on Vercel).',
    },
  },
};

/**
 * Register the jev_decide tool.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - optional deployment config: transport, endpoint, model, key reference, timeouts.
 */
export function apply(ctx, config) {
  const resolved = normalizeConfig(config);
  ctx.tools.register({
    name: 'jev_decide',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    timeoutMs: resolved.toolTimeoutMs,
    output: {
      schema: {
        type: 'object',
        description: 'The provider response: answers keyed by question, plus usage when the provider reports it.',
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: (args, exec) => requestSystemOne(args, exec, resolved),
  });
}
