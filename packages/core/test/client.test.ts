import { expect, test, vi } from 'vitest';
import { listModels, resolveApiKey, run } from '../src/client.js';
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

test('maps a successful response', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    ok({
      model: 'jev-1.13.0',
      answers: { is_urgent: { type: 'noul', noul: 0.99 } },
      usage: { input_tokens: 425, output_tokens: 73 },
    }),
  );
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
  vi.unstubAllEnvs();
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
