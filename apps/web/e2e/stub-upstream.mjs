// A minimal stand-in for the TypeSafe upstream API (`https://api.typesafe.ai`),
// used only by the Playwright e2e smoke test. No dependencies beyond
// `node:http` — this never talks to the real API and costs nothing to run.
//
// Routes:
//   POST /v1/systemone -> the quick-start answer shape, with the `frustration`
//     score answer's `legend`/`probabilities` built from however many levels
//     the request's `questions.frustration.criteria` actually has, so editing
//     the level count in the UI still yields a schema-valid answer.
//   GET  /v1/models    -> `{ models: [...] }` (the shape the installed
//     `@typesafe-ai/sdk`'s `unwrapModels` expects — see stub-upstream note in
//     the task report for why this isn't a bare array).
//   anything else       -> 404 JSON.
//
// Every request's `Authorization` header is checked against `Bearer test-key`
// (the key the e2e's `TYPESAFE_API_KEY` is set to); `badAuth` counts misses.
import { createServer } from 'node:http';

const EXPECTED_AUTHORIZATION = 'Bearer test-key';

const DEFAULT_FRUSTRATION_CRITERIA = [
  'Calm, just stating facts',
  'Frustrated but civil',
  'Very angry, strong language',
];

function jsonResponse(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Build a schema-valid `score` answer sized to the request's own criteria list. */
function buildFrustrationAnswer(frustrationQuestion) {
  const criteria = Array.isArray(frustrationQuestion?.criteria)
    ? frustrationQuestion.criteria
    : DEFAULT_FRUSTRATION_CRITERIA;
  const count = criteria.length;
  const winner = Math.min(1, Math.max(0, count - 1));

  const legend = {};
  const probabilities = {};
  for (let level = 0; level < count; level++) {
    legend[String(level)] = criteria[level];
    probabilities[String(level)] = level === winner ? 1 : 0;
  }

  return {
    type: 'score',
    score: winner,
    confidence: 1,
    legend,
    probabilities,
  };
}

function quickStartResponse(requestBody) {
  const questions =
    requestBody && typeof requestBody === 'object' ? requestBody.questions : undefined;
  const frustrationQuestion =
    questions && typeof questions === 'object' ? questions.frustration : undefined;

  return {
    model: 'jev-1.13.0',
    answers: {
      department: {
        type: 'choice',
        choice: 'technical',
        confidence: 0.75,
        probabilities: { technical: 0.84, sales: 0.0, billing: 0.16 },
      },
      frustration: buildFrustrationAnswer(frustrationQuestion),
      is_urgent: { type: 'noul', noul: 0.99 },
    },
    usage: { input_tokens: 425, output_tokens: 73 },
  };
}

const MODELS_RESPONSE = {
  models: [
    { name: 'jev-latest', description: 'stub', release_date: '2026-09-10T00:00:00Z' },
    { name: 'jev-preview', description: 'stub', release_date: '2026-09-10T00:00:00Z' },
  ],
};

/**
 * Start the stub on an ephemeral 127.0.0.1 port. `requests` accumulates the
 * parsed JSON body of every `/v1/systemone` call (live reference: callers
 * read it after the fact rather than re-fetching); `badAuth` counts requests
 * whose `Authorization` header didn't match `Bearer test-key`.
 */
export async function startStub() {
  const requests = [];
  let badAuth = 0;

  const server = createServer((req, res) => {
    void (async () => {
      const authorization = req.headers['authorization'];
      if (authorization !== EXPECTED_AUTHORIZATION) badAuth += 1;

      if (req.method === 'POST' && req.url === '/v1/systemone') {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          jsonResponse(res, 400, { error: 'invalid JSON body' });
          return;
        }
        requests.push(body);
        jsonResponse(res, 200, quickStartResponse(body));
        return;
      }

      if (req.method === 'GET' && req.url === '/v1/models') {
        jsonResponse(res, 200, MODELS_RESPONSE);
        return;
      }

      jsonResponse(res, 404, { error: `no stub route for ${req.method} ${req.url}` });
    })().catch((err) => {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });

  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : 0;

  return {
    port,
    requests,
    get badAuth() {
      return badAuth;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve(undefined)));
      }),
  };
}

// Usable as a standalone process too: `node e2e/stub-upstream.mjs` prints the
// port it bound so it can be pointed at manually.
if (import.meta.url === `file://${process.argv[1]}`) {
  const stub = await startStub();
  process.stdout.write(`STUB_PORT=${stub.port}\n`);
}
