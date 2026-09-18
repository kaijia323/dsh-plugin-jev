/**
 * Smoke test for dsh-plugin-jev: registers the tool against a mock ctx and
 * executes it against mock TypeSafe and mock Vercel AI Gateway endpoints,
 * covering both transports, key resolution, and the error paths. No DSH
 * process and no real API key required.
 *
 * Run: node test/smoke.mjs
 */
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../lib/index.js';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

async function expectError(label, fn, expectedSubstring) {
  try {
    await fn();
    check(label, false, 'expected an error, got success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, message.includes(expectedSubstring), message);
  }
}

const CANNED = {
  model: 'jev-latest',
  answers: {
    dept: {
      type: 'choice',
      choice: 'billing',
      probabilities: { billing: 0.84, technical: 0.159, sales: 0.001 },
      confidence: 0.596,
    },
    urgent: { type: 'noul', noul: 0.999 },
  },
  usage: { input_tokens: 312, output_tokens: 48 },
};

const GATEWAY_CANNED = {
  answers: {
    dept: { type: 'choice', choice: 'billing', probabilities: { billing: 0.84, technical: 0.16 } },
    passed: { type: 'boolean', probability: 0.01 },
  },
  usage: { inputTokens: 312, outputTokens: 48 },
  warnings: [],
};

let lastBody = null;
let lastAuth = null;
let lastGatewayHeaders = null;
let lastGatewayBody = null;
let calls = 0;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (req.method === 'POST' && req.url === '/v1/systemone') {
      calls += 1;
      lastAuth = req.headers.authorization;
      lastBody = parsed;
      if (parsed && parsed.state === 'FAIL') {
        res.writeHead(401, { 'content-type': 'text/plain' }).end('invalid api key');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(CANNED));
      return;
    }
    if (req.method === 'POST' && req.url === '/gateway/evaluation-model') {
      calls += 1;
      lastGatewayHeaders = req.headers;
      lastGatewayBody = parsed;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(GATEWAY_CANNED));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseURL = 'http://127.0.0.1:' + server.address().port;

function register(config) {
  const registered = [];
  apply({ tools: { register: (definition) => { registered.push(definition); return () => {}; } } }, config);
  return registered;
}

process.env.SMOKE_KEY = 'ts_smoke';

// --- registration ---------------------------------------------------------
const tools = register({ baseURL, apiKeyEnv: 'SMOKE_KEY', model: 'jev-test', timeoutMs: 5000 });
check('registers exactly one tool', tools.length === 1, String(tools.length));
const tool = tools[0];
check('tool name is jev_decide', tool.name === 'jev_decide', tool.name);
check('declares output.render', typeof tool.output.render === 'function');
check('declares output.schema object root', tool.output.schema.type === 'object');
check('declares a positive timeoutMs', typeof tool.timeoutMs === 'number' && tool.timeoutMs > 5000, String(tool.timeoutMs));
check('parameters require state and questions', Array.isArray(tool.parameters.required) && tool.parameters.required.join(',') === 'state,questions');
const rendered = tool.output.render({}, CANNED);
check('render emits one text block', Array.isArray(rendered) && rendered.length === 1 && rendered[0].type === 'text');
check('render text carries the answers', rendered[0].text.includes('"choice": "billing"'), rendered[0].text.slice(0, 80));

// --- typesafe transport: happy path ---------------------------------------
const questions = {
  dept: { type: 'choice', instructions: 'Which team handles this', criteria: { billing: 'payments', technical: 'bugs' } },
  urgent: { type: 'noul', instructions: 'Does the message convey urgency?' },
};
const result = await tool.execute(
  { state: 'Customer cannot connect Stripe for 3 days', questions },
  { signal: new AbortController().signal },
);
check('returns the API body unchanged', JSON.stringify(result) === JSON.stringify(CANNED));
check('sends the configured bearer token', lastAuth === 'Bearer ts_smoke', String(lastAuth));
check('uses the configured default model', lastBody.model === 'jev-test', JSON.stringify(lastBody && lastBody.model));
check('forwards state verbatim', lastBody.state === 'Customer cannot connect Stripe for 3 days');
check('forwards the question map verbatim', JSON.stringify(lastBody.questions) === JSON.stringify(questions));

await tool.execute({ state: 'x', model: 'jev-latest', questions: { q: { type: 'noul', instructions: 'y?' } } }, {});
check('honors a per-call model override', lastBody.model === 'jev-latest');
const defaultTool = register({ baseURL, apiKeyEnv: 'SMOKE_KEY' })[0];
await defaultTool.execute({ state: 'x', questions: { q: { type: 'noul', instructions: 'y?' } } }, {});
check('unconfigured model defaults to jev-latest', lastBody.model === 'jev-latest', String(lastBody && lastBody.model));

// --- vercel transport -----------------------------------------------------
process.env.GW_KEY = 'gw_smoke';
const gatewayTools = register({
  transport: 'vercel',
  gatewayBaseURL: baseURL + '/gateway',
  apiKeyEnv: 'GW_KEY',
  timeoutMs: 5000,
});
check('vercel transport registers one tool', gatewayTools.length === 1);
const gatewayTool = gatewayTools[0];
const gatewayResult = await gatewayTool.execute(
  {
    state: 'The build failed with exit code 1.',
    questions: {
      dept: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'payments', technical: 'bugs' } },
      passed: { type: 'noul', instructions: 'Did the build succeed?' },
    },
  },
  { signal: new AbortController().signal },
);
check('vercel returns the gateway body unchanged', JSON.stringify(gatewayResult) === JSON.stringify(GATEWAY_CANNED));
check('vercel sends the gateway bearer token', lastGatewayHeaders.authorization === 'Bearer gw_smoke', String(lastGatewayHeaders.authorization));
check('vercel defaults to the typesafe-ai/jev model', lastGatewayHeaders['ai-model-id'] === 'typesafe-ai/jev', String(lastGatewayHeaders['ai-model-id']));
check('vercel sends the protocol version header', lastGatewayHeaders['ai-gateway-protocol-version'] === '0.0.1', String(lastGatewayHeaders['ai-gateway-protocol-version']));
check('vercel sends the evaluation spec version header', lastGatewayHeaders['ai-evaluation-model-specification-version'] === '4', String(lastGatewayHeaders['ai-evaluation-model-specification-version']));
check('vercel translates noul to boolean', lastGatewayBody.questions.passed.type === 'boolean', JSON.stringify(lastGatewayBody.questions));
check('vercel keeps choice criteria', lastGatewayBody.questions.dept.criteria.billing === 'payments');
check('vercel body has no model field', lastGatewayBody.model === undefined);

// --- key resolution -------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'jev-smoke-'));
const keyFile = join(dir, 'key');
await writeFile(keyFile, 'ts_from_file\n', 'utf8');
const fileTool = register({ baseURL, apiKeyEnv: 'NO_SUCH_ENV_VAR', keyFile })[0];
delete process.env.JEV_API_KEY;
await fileTool.execute({ state: 'x', questions: { q: { type: 'noul', instructions: 'y?' } } }, {});
check('falls back to the key file', lastAuth === 'Bearer ts_from_file', String(lastAuth));
process.env.JEV_API_KEY = 'ts_from_jev_env';
const envTool = register({ baseURL, apiKeyEnv: 'NO_SUCH_ENV_VAR', keyFile: '/nonexistent/key' })[0];
await envTool.execute({ state: 'x', questions: { q: { type: 'noul', instructions: 'y?' } } }, {});
check('falls back to JEV_API_KEY', lastAuth === 'Bearer ts_from_jev_env', String(lastAuth));
delete process.env.JEV_API_KEY;
await rm(dir, { recursive: true, force: true });

const keylessTool = register({ baseURL, apiKeyEnv: 'NO_SUCH_ENV_VAR', keyFile: '/nonexistent/key' })[0];
await expectError(
  'reports a missing key with all sources',
  () => keylessTool.execute({ state: 'x', questions: { q: { type: 'noul', instructions: 'y?' } } }, {}),
  'no API key',
);
delete process.env.GW_KEY;
const keylessGateway = register({
  transport: 'vercel',
  gatewayBaseURL: baseURL + '/gateway',
  apiKeyEnv: 'NO_SUCH_ENV_VAR',
  keyFile: '/nonexistent/key',
})[0];
await expectError(
  'vercel reports a missing gateway key',
  () => keylessGateway.execute({ state: 'x', questions: { q: { type: 'noul', instructions: 'y?' } } }, {}),
  'AI Gateway key',
);

// --- validation and transport errors --------------------------------------
process.env.SMOKE_KEY = 'ts_smoke';
await expectError(
  'rejects an empty state',
  () => tool.execute({ state: '   ', questions }, {}),
  'state must be a non-empty string',
);
await expectError(
  'rejects an unknown question type',
  () => tool.execute({ state: 'x', questions: { q: { type: 'label', instructions: 'y?' } } }, {}),
  'must be one of',
);
await expectError(
  'rejects a choice without criteria',
  () => tool.execute({ state: 'x', questions: { q: { type: 'choice', instructions: 'y?' } } }, {}),
  'criteria is required',
);
await expectError(
  'rejects an empty question map',
  () => tool.execute({ state: 'x', questions: {} }, {}),
  'at least one question',
);
await expectError(
  'surfaces an HTTP error with its status',
  () => tool.execute({ state: 'FAIL', questions: { q: { type: 'noul', instructions: 'y?' } } }, {}),
  'HTTP 401',
);
const wrongPathTool = register({ baseURL: baseURL + '/nope', apiKeyEnv: 'SMOKE_KEY' })[0];
await expectError(
  'surfaces a 404 from a wrong endpoint',
  () => wrongPathTool.execute({ state: 'x', questions: { q: { type: 'noul', instructions: 'y?' } } }, {}),
  'HTTP 404',
);
await expectError(
  'rejects a malformed baseURL',
  () => register({ baseURL: 'not a url', apiKeyEnv: 'SMOKE_KEY' }),
  'baseURL is not a valid URL',
);
await expectError(
  'rejects an unknown transport',
  () => register({ transport: 'openrouter' }),
  'transport must be',
);

server.close();
console.log('');
console.log(failures === 0 ? 'SMOKE OK (' + calls + ' mock requests)' : 'SMOKE FAILED: ' + failures + ' check(s)');
process.exit(failures === 0 ? 0 : 1);
