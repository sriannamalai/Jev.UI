import { APIUserAbortError } from '@typesafe-ai/sdk';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { listModels, resolveApiKey, run } from '../src/client.js';
import { JevError } from '../src/errors.js';
import type { Request } from '../src/schema.js';

// `model` is explicit because the SDK always fills a resolved `model` into the wire body
// (`{ ...request, model: request.model ?? defaultModel }`); an omitted model would make the
// sent body diverge from `req` and break the `toEqual(req)` assertion below.
const req: Request = {
  state: 'A customer says: I was charged twice.',
  model: 'jev-1.13.0',
  questions: { is_urgent: { type: 'noul', instructions: 'Is this urgent?' } },
};

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const fail = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
  });

const validOk = () =>
  ok({
    model: 'jev-1.13.0',
    answers: { is_urgent: { type: 'noul', noul: 0.99 } },
    usage: { input_tokens: 425, output_tokens: 73 },
  });

beforeEach(() => {
  // A developer's shell setting these must not change the baseURL assertion below or make the
  // SDK print request/response bodies (and a partially masked Authorization header) mid-suite.
  vi.stubEnv('TYPESAFE_BASE_URL', '');
  vi.stubEnv('TYPESAFE_LOG_LEVEL', '');
});

afterEach(() => {
  // Always via afterEach (not inline at the end of each test) so a failing assertion earlier in
  // a test can never leak a stubbed env into later tests.
  vi.unstubAllEnvs();
});

test('maps a successful response', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => validOk());
  const r = await run(req, { apiKey: 'k', fetch, maxRetries: 0 });
  expect(r.model).toBe('jev-1.13.0');
  expect(r.usage).toEqual({ inputTokens: 425, outputTokens: 73 });
  expect(r.costUsd).toBeCloseTo(0.00001785, 10);
  expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  const [url, init] = fetch.mock.calls[0]!;
  expect(String(url)).toBe('https://api.typesafe.ai/v1/systemone');
  expect(JSON.parse(init!.body as string)).toEqual(req);
});

test('no key rejects before any fetch', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', '');
  const fetch = vi.fn();
  await expect(run(req, { apiKey: '  ', fetch })).rejects.toMatchObject({ kind: 'noKey' });
  expect(fetch).not.toHaveBeenCalled();
});

test('401 maps to auth', async () => {
  const fetch = vi.fn(async () =>
    fail(401, {
      detail: {
        error_type: 'authentication_error',
        message: 'Cannot authenticate with the server. Please check your API key and try again.',
      },
    }),
  );
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'auth',
    message: 'Cannot authenticate with the server. Please check your API key and try again.',
  });
});

test('403 (no key sent upstream) maps to auth', async () => {
  const fetch = vi.fn(async () =>
    fail(403, {
      detail: {
        error_type: 'authentication_error',
        message: 'Must supply an API key! Check your request and try again.',
      },
    }),
  );
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'auth',
    message: 'Must supply an API key! Check your request and try again.',
  });
});

test('real 422 body maps to validation with an upstream-derived path', async () => {
  const fetch = vi.fn(async () =>
    fail(422, {
      detail: [
        {
          type: 'list_type',
          loc: ['body', 'questions', 'q', 'score', 'criteria'],
          msg: 'Input should be a valid list',
          input: 'notalist',
        },
      ],
    }),
  );
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'validation',
    message: 'Input should be a valid list',
    path: 'questions.q.criteria',
  });
});

test('400 unknown-model body maps to validation with no path', async () => {
  const fetch = vi.fn(async () =>
    fail(400, {
      detail: { error_type: 'api_usage_error', message: 'Unknown model: nope-1' },
    }),
  );
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'validation',
    message: 'Unknown model: nope-1',
    path: undefined,
  });
});

test('400 with a string detail surfaces the message and the question path', async () => {
  const stringDetailReq: Request = {
    state: 'A customer says: I was charged twice.',
    model: 'jev-1.13.0',
    questions: { question_1: { type: 'noul', instructions: '' } },
  };
  const fetch = vi.fn(async () =>
    fail(400, { detail: 'Noul question must have criteria or instructions: question_1' }),
  );
  await expect(run(stringDetailReq, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'validation',
    message: 'Noul question must have criteria or instructions: question_1',
    path: 'questions.question_1',
  });
});

test('400 with a string detail naming an unknown id yields no path', async () => {
  const stringDetailReq: Request = {
    state: 'A customer says: I was charged twice.',
    model: 'jev-1.13.0',
    questions: { question_1: { type: 'noul', instructions: '' } },
  };
  const fetch = vi.fn(async () =>
    fail(400, { detail: 'Noul question must have criteria or instructions: not_a_question' }),
  );
  await expect(run(stringDetailReq, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'validation',
    message: 'Noul question must have criteria or instructions: not_a_question',
    path: undefined,
  });
});

test('429 maps to rateLimit with retryAfterMs from the retry-after header', async () => {
  const fetch = vi.fn(async () =>
    fail(
      429,
      { detail: { error_type: 'rate_limit_error', message: 'Too many requests' } },
      { 'retry-after': '2' },
    ),
  );
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'rateLimit',
    retryAfterMs: 2000,
  });
});

test('529 maps to overloaded', async () => {
  const fetch = vi.fn(async () =>
    fail(529, { detail: { error_type: 'overloaded_error', message: 'Overloaded' } }),
  );
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'overloaded',
  });
});

test('a network failure (fetch rejecting with TypeError) maps to network', async () => {
  const fetch = vi.fn(async () => {
    throw new TypeError('fetch failed');
  });
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'network',
  });
});

test('a 429 then a 200 with maxRetries: 1 resolves and calls fetch twice', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      fail(
        429,
        { detail: { error_type: 'rate_limit_error', message: 'Too many requests' } },
        { 'retry-after-ms': '0' },
      ),
    )
    .mockResolvedValueOnce(
      ok({
        model: 'jev-1.13.0',
        answers: { is_urgent: { type: 'noul', noul: 0.5 } },
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );
  const r = await run(req, { apiKey: 'k', fetch, maxRetries: 1 });
  expect(r.model).toBe('jev-1.13.0');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('a malformed upstream answer maps to unexpected', async () => {
  const fetch = vi.fn(async () =>
    ok({
      model: 'jev-1.13.0',
      answers: { is_urgent: { type: 'noul', noul: 'not-a-number' } },
      usage: { input_tokens: 10, output_tokens: 2 },
    }),
  );
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'unexpected',
  });
});

test('listModels maps release_date to releaseDate', async () => {
  const fetch = vi.fn(async () =>
    ok({
      models: [{ name: 'jev-1.13.0', description: 'Latest Jev model', release_date: '2026-08-01' }],
    }),
  );
  const models = await listModels({ apiKey: 'k', fetch, maxRetries: 0 });
  expect(models).toEqual([
    { name: 'jev-1.13.0', description: 'Latest Jev model', releaseDate: '2026-08-01' },
  ]);
});

test('resolveApiKey trims and falls back to the env var', () => {
  expect(resolveApiKey(undefined, { TYPESAFE_API_KEY: ' k ' } as NodeJS.ProcessEnv)).toBe('k');
  expect(resolveApiKey('  explicit  ', { TYPESAFE_API_KEY: 'env' } as NodeJS.ProcessEnv)).toBe(
    'explicit',
  );
  expect(resolveApiKey('  ', { TYPESAFE_API_KEY: '  ' } as NodeJS.ProcessEnv)).toBeUndefined();
  expect(resolveApiKey(undefined, undefined)).toBeUndefined();
});

// --- F1: buildClient() failures must normalise to JevError, not escape raw. ---

test('an invalid maxRetries surfaces as an unexpected JevError, not a raw SDK error', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: -1 })).rejects.toBeInstanceOf(JevError);
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: -1 })).rejects.toMatchObject({
    kind: 'unexpected',
  });
  expect(fetch).not.toHaveBeenCalled();
});

// --- F2: the 200 envelope is never validated by the SDK; we must validate it ourselves. ---

test('a 200 body missing model/answers/usage maps to unexpected', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => ok({}));
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'unexpected',
  });
});

test('a 200 body with a non-object answers maps to unexpected', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    ok({ model: 'jev-1.13.0', answers: 42, usage: { input_tokens: 1, output_tokens: 1 } }),
  );
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'unexpected',
  });
});

test('a 200 body with an array answers maps to unexpected', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    ok({ model: 'jev-1.13.0', answers: [], usage: { input_tokens: 1, output_tokens: 1 } }),
  );
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'unexpected',
  });
});

test('a 200 body missing usage maps to unexpected', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    ok({ model: 'jev-1.13.0', answers: {} }),
  );
  await expect(run(req, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'unexpected',
  });
});

test('a 200 body with a non-numeric input_tokens maps to unexpected and never echoes the value', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    ok({ model: 'jev-1.13.0', answers: {}, usage: { input_tokens: '425', output_tokens: 1 } }),
  );
  const err: JevError = await run(req, { apiKey: 'k', fetch, maxRetries: 0 }).catch((e) => e);
  expect(err.kind).toBe('unexpected');
  expect(err.message).not.toContain('425');
});

test('a 200 plain-text body maps to unexpected and never echoes the body', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response('<html>not json</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  );
  const err: JevError = await run(req, { apiKey: 'k', fetch, maxRetries: 0 }).catch((e) => e);
  expect(err.kind).toBe('unexpected');
  expect(err.message).not.toContain('html');
});

test('listModels rejects a bare-array response (missing the {models:...} envelope) as unexpected', async () => {
  // The SDK's own `unwrapModels` requires `{ models: [...] }`; a bare top-level array fails the
  // SDK's own shape check before our wrapper's validation ever runs. Unlike systemOne's
  // pre-flight validation (see M7 below), this is not a request-shape mistake the caller made —
  // it stays `unexpected`.
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    ok([{ name: 'jev-1.13.0', description: 'd', release_date: '2026-08-01' }]),
  );
  await expect(listModels({ apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'unexpected',
  });
});

test('listModels rejects model entries with the wrong field types as unexpected', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    ok({ models: [{ name: 123, description: 'd', release_date: '2026-08-01' }] }),
  );
  await expect(listModels({ apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'unexpected',
  });
});

// --- M5: signal abort, APITimeoutError, and opts.now coverage. ---

test('an already-aborted signal rethrows the SDK abort error as-is, not a JevError', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return validOk();
  });
  const promise = run(req, { apiKey: 'k', fetch, signal: controller.signal, maxRetries: 0 });
  await expect(promise).rejects.toBeInstanceOf(APIUserAbortError);
  await expect(promise).rejects.not.toBeInstanceOf(JevError);
});

test('a request that exceeds the SDK timeout maps to timeout', async () => {
  vi.useFakeTimers();
  try {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }),
    );
    const promise = run(req, { apiKey: 'k', fetch, maxRetries: 0 });
    const assertion = expect(promise).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});

test('latencyMs is computed from opts.now', async () => {
  const now = vi.fn<() => number>().mockReturnValueOnce(100).mockReturnValueOnce(350);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => validOk());
  const r = await run(req, { apiKey: 'k', fetch, maxRetries: 0, now });
  expect(r.latencyMs).toBe(250);
});

// --- M7: systemOne's own pre-flight validation is a user-fixable input error. ---

test('a pre-flight validation error from systemOne maps to validation, not unexpected', async () => {
  const badReq = {
    state: 'x',
    // A score question needs at least two criteria; cast past the type system the way a
    // dynamically-built request (e.g. from a QuestionSet the SDK's own types can't see) could.
    questions: { q: { type: 'score', instructions: 'rate this', criteria: ['only one'] } },
  } as unknown as Request;
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(run(badReq, { apiKey: 'k', fetch, maxRetries: 0 })).rejects.toMatchObject({
    kind: 'validation',
  });
  expect(fetch).not.toHaveBeenCalled();
});

// --- M8: the wrapper pins a quiet log level regardless of TYPESAFE_LOG_LEVEL. ---

test('a successful run never writes to console even if TYPESAFE_LOG_LEVEL requests debug output', async () => {
  vi.stubEnv('TYPESAFE_LOG_LEVEL', 'debug');
  const methods = ['log', 'info', 'debug', 'warn', 'error'] as const;
  const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  try {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => validOk());
    await run(req, { apiKey: 'k', fetch, maxRetries: 0 });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
