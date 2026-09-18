/**
 * Fixture check for test/mock-typesafe.mjs: spawns the mock as a child process
 * on an ephemeral port with a temporary request log, posts one request to each
 * of its two routes, and asserts the sentinel answers plus the logged
 * authorization / ai-model-id headers. The mock is killed and the log removed
 * on every exit path.
 *
 * This is what makes mock-typesafe.mjs a tested fixture instead of dead code.
 *
 * Run: node test/fixture-check.mjs   (exit 0 = pass, 1 = fail)
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const mockPath = join(testDir, 'mock-typesafe.mjs');
const HARD_TIMEOUT_MS = 20000;
const AUTH = 'Bearer fixture-check-key';
const MODEL = 'fixture-check-model';

let failures = 0;
function check(label, condition, extra) {
  if (condition) {
    console.log('PASS ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + extra));
  }
}

/** Ask the OS for a currently free loopback port. */
async function freePort() {
  const probe = createServer();
  await new Promise((resolveListen) => probe.listen(0, '127.0.0.1', resolveListen));
  const port = probe.address().port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
}

async function post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: AUTH, 'ai-model-id': MODEL },
    body: JSON.stringify(body),
  });
}

/** Wait for the mock's TCP port to accept connections without sending it traffic. */
function waitForPort(port, timeoutMs) {
  return new Promise((resolveReady) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const socket = createConnection({ host: '127.0.0.1', port });
      const done = (ok) => {
        socket.destroy();
        if (ok) resolveReady(true);
        else if (Date.now() > deadline) resolveReady(false);
        else setTimeout(attempt, 100);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    };
    attempt();
  });
}

const guard = setTimeout(() => {
  try {
    child.kill('SIGKILL');
  } catch {
    // The child may not exist yet; the guard only exists to avoid a hang.
  }
  console.log('FAIL fixture check exceeded ' + HARD_TIMEOUT_MS + ' ms');
  console.log('FIXTURE FAILED: 1 check(s)');
  process.exit(1);
}, HARD_TIMEOUT_MS);

const port = await freePort();
const logDir = await mkdtemp(join(tmpdir(), 'jev-fixture-'));
const logPath = join(logDir, 'mock.log');
const base = 'http://127.0.0.1:' + port;

const child = spawn(process.execPath, [mockPath], {
  cwd: resolve(testDir, '..'),
  env: { ...process.env, MOCK_PORT: String(port), MOCK_LOG: logPath },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childOut = '';
let childErr = '';
child.stdout.on('data', (chunk) => {
  childOut += chunk;
});
child.stderr.on('data', (chunk) => {
  childErr += chunk;
});
let spawnError = null;
child.on('error', (error) => {
  spawnError = error;
});

let exitCode = 1;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready && spawnError === null; attempt += 1) {
    ready = await waitForPort(port, 500);
  }
  check('mock-typesafe.mjs starts and answers', ready, childErr || childOut || String(spawnError));

  if (ready) {
    const nativeResponse = await post(base + '/v1/systemone', {
      state: 'fixture state',
      model: 'jev-mock',
      questions: { dept: { type: 'choice', instructions: 'Which?', criteria: { a: 'b' } } },
    });
    const nativeBody = await nativeResponse.json();
    check('native route answers HTTP 200', nativeResponse.status === 200, String(nativeResponse.status));
    check(
      'native route returns SENTINEL_DEPT',
      nativeBody?.answers?.dept?.choice === 'SENTINEL_DEPT',
      JSON.stringify(nativeBody?.answers?.dept),
    );

    const gatewayResponse = await post(base + '/gateway/evaluation-model', {
      state: 'fixture state',
      questions: { dept: { type: 'choice', instructions: 'Which?', criteria: { a: 'b' } } },
    });
    const gatewayBody = await gatewayResponse.json();
    check('gateway route answers HTTP 200', gatewayResponse.status === 200, String(gatewayResponse.status));
    check(
      'gateway route returns GATEWAY_SENTINEL',
      gatewayBody?.answers?.dept?.choice === 'GATEWAY_SENTINEL',
      JSON.stringify(gatewayBody?.answers?.dept),
    );

    let log = '';
    try {
      log = await readFile(logPath, 'utf8');
    } catch (error) {
      log = '<unreadable: ' + error.message + '>';
    }
    const lines = log
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    check('mock logged exactly two requests', lines.length === 2, String(lines.length));
    check(
      'mock logged the authorization header',
      lines.length === 2 && lines.every((line) => line.auth === AUTH),
      JSON.stringify(lines.map((line) => line.auth)),
    );
    check(
      'mock logged the ai-model-id header',
      lines.length === 2 && lines.every((line) => line.gatewayModel === MODEL),
      JSON.stringify(lines.map((line) => line.gatewayModel)),
    );
    check(
      'mock logged both routes',
      lines.length === 2 && lines.some((line) => line.url === '/v1/systemone') && lines.some((line) => line.url === '/gateway/evaluation-model'),
      JSON.stringify(lines.map((line) => line.url)),
    );
  }
  exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  check('fixture check ran without throwing', false, error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  clearTimeout(guard);
  child.kill('SIGKILL');
  await rm(logDir, { recursive: true, force: true });
}

console.log('');
console.log(exitCode === 0 ? 'FIXTURE OK' : 'FIXTURE FAILED: ' + failures + ' check(s)');
process.exit(exitCode);
