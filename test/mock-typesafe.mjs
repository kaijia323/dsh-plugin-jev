/**
 * Mock Jev endpoints for end-to-end tests: the native TypeSafe route and the
 * Vercel AI Gateway evaluation route. Logs every request and answers with
 * sentinel values so a passing test proves the tool result reached the model.
 */
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const port = Number(process.env.MOCK_PORT || 8799);
const logPath = process.env.MOCK_LOG || '/tmp/jev-mock.log';

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    appendFileSync(
      logPath,
      JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization, gatewayModel: req.headers['ai-model-id'], body: raw }) + '\n',
    );
    if (req.method === 'POST' && req.url === '/v1/systemone') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          model: 'jev-mock',
          answers: {
            dept: { type: 'choice', choice: 'SENTINEL_DEPT', probabilities: { SENTINEL_DEPT: 0.91 }, confidence: 0.77 },
            urgency: { type: 'noul', noul: 0.777 },
          },
          usage: { input_tokens: 11, output_tokens: 7 },
        }),
      );
      return;
    }
    if (req.method === 'POST' && req.url === '/gateway/evaluation-model') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          answers: {
            dept: { type: 'choice', choice: 'GATEWAY_SENTINEL', probabilities: { GATEWAY_SENTINEL: 0.93 } },
            urgency: { type: 'boolean', probability: 0.888 },
          },
          usage: { inputTokens: 21, outputTokens: 9 },
          warnings: [],
        }),
      );
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log('mock jev endpoints listening on http://127.0.0.1:' + port);
});
