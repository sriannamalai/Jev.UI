import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QuestionSet, Request } from '@jev-ui/core/browser';
import { ApiError, createApi } from '../src/api.js';

const SAMPLE_REQUEST: Request = {
  state: 'the customer says the app crashed',
  questions: {
    crashed: { type: 'noul', instructions: 'did the app crash?' },
  },
};

const SAMPLE_SET: QuestionSet = {
  name: 'support-triage',
  questions: {
    crashed: { type: 'noul', instructions: 'did the app crash?' },
  },
};

function mockFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  return vi.fn<typeof fetch>(impl);
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function noBodyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('no body');
    },
    text: async () => '',
  } as unknown as Response;
}

function htmlResponse(status: number, html: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    },
    text: async () => html,
  } as unknown as Response;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected promise to reject');
}

function malformedJsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
    text: async () => 'not json',
  } as unknown as Response;
}

describe('api', () => {
  it('health() issues GET /api/health and returns the body', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(200, { keyConfigured: true, version: '0.1.0', setsDir: '/sets' }),
    );
    const api = createApi(fetchMock);

    const result = await api.health();

    expect(result).toEqual({ keyConfigured: true, version: '0.1.0', setsDir: '/sets' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/health');
    expect(init.method).toBe('GET');
  });

  it('models() issues GET /api/models', async () => {
    const models = [{ name: 'jev-latest', description: 'x', releaseDate: '2026-01-01' }];
    const fetchMock = mockFetch(async () => jsonResponse(200, models));
    const api = createApi(fetchMock);

    const result = await api.models();

    expect(result).toEqual(models);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/models');
    expect(init.method).toBe('GET');
  });

  it('run() issues POST /api/run with { request, setName } and content-type json', async () => {
    const runResult = {
      answers: {},
      model: 'jev-latest',
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 10,
      costUsd: 0.001,
    };
    const fetchMock = mockFetch(async () => jsonResponse(200, runResult));
    const api = createApi(fetchMock);

    const result = await api.run(SAMPLE_REQUEST, 'support-triage');

    expect(result).toEqual(runResult);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/run');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      request: SAMPLE_REQUEST,
      setName: 'support-triage',
    });
  });

  it('run() omits setName from the body when not given', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(200, {
        answers: {},
        model: 'jev-latest',
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 10,
        costUsd: 0.001,
      }),
    );
    const api = createApi(fetchMock);

    await api.run(SAMPLE_REQUEST);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ request: SAMPLE_REQUEST });
  });

  it('run() forwards the caller signal', async () => {
    const controller = new AbortController();
    const fetchMock = mockFetch(async () =>
      jsonResponse(200, {
        answers: {},
        model: 'jev-latest',
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 10,
        costUsd: 0.001,
      }),
    );
    const api = createApi(fetchMock);

    await api.run(SAMPLE_REQUEST, undefined, controller.signal);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('listSets() issues GET /api/sets', async () => {
    const sets = [{ name: 'support-triage', questionCount: 1, valid: true }];
    const fetchMock = mockFetch(async () => jsonResponse(200, sets));
    const api = createApi(fetchMock);

    const result = await api.listSets();

    expect(result).toEqual(sets);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sets');
  });

  it('getSet(name) issues GET /api/sets/:name with the name encoded', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(200, SAMPLE_SET));
    const api = createApi(fetchMock);

    const result = await api.getSet('a b');

    expect(result).toEqual(SAMPLE_SET);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sets/a%20b');
  });

  it('putSet(name, set) issues PUT with a JSON body and resolves undefined on 204', async () => {
    const fetchMock = mockFetch(async () => noBodyResponse(204));
    const api = createApi(fetchMock);

    const result = await api.putSet('support-triage', SAMPLE_SET);

    expect(result).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sets/support-triage');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual(SAMPLE_SET);
  });

  it('rejects with an ApiError carrying kind/path/status for a well-formed ErrorBody', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(400, { error: { kind: 'validation', message: 'bad state', path: 'state' } }),
    );
    const api = createApi(fetchMock);

    const err = await rejectionOf(api.models());
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      kind: 'validation',
      message: 'bad state',
      path: 'state',
      status: 400,
    });
  });

  it('maps an unknown error kind to "unexpected", keeping the server message and status', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(400, { error: { kind: 'weird', message: 'm' } }),
    );
    const api = createApi(fetchMock);

    const err = await rejectionOf(api.models());
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'unexpected', message: 'm', status: 400 });
  });

  it('drops a non-string path from an otherwise well-formed error body', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(422, { error: { kind: 'validation', message: 'm', path: 42 } }),
    );
    const api = createApi(fetchMock);

    const err = await rejectionOf(api.models());
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).path).toBeUndefined();
  });

  it('falls back to "unexpected" with an HTTP-status message when the server message is not a string', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(422, { error: { kind: 'validation', message: 5 } }),
    );
    const api = createApi(fetchMock);

    const err = await rejectionOf(api.models());
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'unexpected', message: 'HTTP 422' });
  });

  it('maps a non-2xx HTML response to an unexpected ApiError', async () => {
    const fetchMock = mockFetch(async () => htmlResponse(502, '<html>Bad Gateway</html>'));
    const api = createApi(fetchMock);

    const err = await rejectionOf(api.models());
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'unexpected', message: 'HTTP 502' });
  });

  it('maps a non-2xx malformed-JSON response to an unexpected ApiError', async () => {
    const fetchMock = mockFetch(async () => malformedJsonResponse(500));
    const api = createApi(fetchMock);

    const err = await rejectionOf(api.models());
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'unexpected', message: 'HTTP 500' });
  });

  it('maps a non-2xx empty-body response to an unexpected ApiError', async () => {
    const fetchMock = mockFetch(async () => noBodyResponse(500));
    const api = createApi(fetchMock);

    const err = await rejectionOf(api.models());
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'unexpected', message: 'HTTP 500' });
  });

  it('maps a 2xx response whose body is not valid JSON to an unexpected ApiError', async () => {
    const fetchMock = mockFetch(async () => malformedJsonResponse(200));
    const api = createApi(fetchMock);

    const err = await rejectionOf(api.models());
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'unexpected', message: 'HTTP 200' });
  });

  it('maps a rejecting fetch to a network ApiError', async () => {
    const fetchMock = mockFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const api = createApi(fetchMock);

    const err = await rejectionOf(api.models());
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'network', message: 'Cannot reach the Jev.UI server' });
  });

  it('rethrows an AbortError from the caller signal as-is (not wrapped)', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    const fetchMock = mockFetch(async () => {
      throw abortError;
    });
    const api = createApi(fetchMock);

    await expect(api.run(SAMPLE_REQUEST)).rejects.toBe(abortError);
  });

  it('binds fetch lazily so a globalThis.fetch stub applied after createApi() still works', async () => {
    const { api } = await import('../src/api.js');
    const fetchMock = mockFetch(async () =>
      jsonResponse(200, { keyConfigured: false, version: 'x', setsDir: 'y' }),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const result = await api.health();
      expect(result).toEqual({ keyConfigured: false, version: 'x', setsDir: 'y' });
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('every requested URL is relative and starts with /api/', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(200, []));
    const api = createApi(fetchMock);

    await api.listSets();
    await api.models();

    for (const call of fetchMock.mock.calls) {
      const url = call[0] as string;
      expect(url.startsWith('/api/')).toBe(true);
      expect(url.startsWith('http://')).toBe(false);
      expect(url.startsWith('https://')).toBe(false);
    }
  });

  it('never sends credentials or custom auth headers', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(200, []));
    const api = createApi(fetchMock);

    await api.listSets();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(init?.credentials).toBeUndefined();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });
});

describe('module boundary', () => {
  it('never imports the Node entry point "@jev-ui/core" (only "@jev-ui/core/browser")', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const srcDir = join(testDir, '..', 'src');
    expect(existsSync(srcDir)).toBe(true);

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const text = readFileSync(full, 'utf8');
        const matches = text.matchAll(/from\s+['"]([^'"]+)['"]/g);
        for (const match of matches) {
          const specifier = match[1];
          if (specifier === '@jev-ui/core') {
            offenders.push(full);
          }
        }
      }
    };
    walk(srcDir);

    expect(offenders).toEqual([]);
  });
});
