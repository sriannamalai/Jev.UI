import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JevError, SetError } from '@jev-ui/core';
import type {
  HistoryRecord,
  HistoryStore,
  JevErrorKind,
  ModelInfo,
  QuestionSet,
  Request,
  RunResult,
  SetSummary,
  SetsStore,
} from '@jev-ui/core';
import type { Hono } from 'hono';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from '../src/app.js';

const HOST = '127.0.0.1:4173';

const REQUEST: Request = {
  state: 'the ticket is on fire',
  questions: { q: { type: 'noul', instructions: 'is it urgent?' } },
};

const RESULT: RunResult = {
  answers: { q: { type: 'noul', noul: 0.91 } },
  model: 'jev-latest',
  usage: { inputTokens: 12, outputTokens: 3 },
  latencyMs: 42,
  costUsd: 0.00012,
};

const SET: QuestionSet = {
  name: 'triage',
  questions: { q: { type: 'noul', instructions: 'is it urgent?' } },
};

const MODELS: ModelInfo[] = [
  { name: 'jev-latest', description: 'latest', releaseDate: '2026-01-01' },
];

interface Fakes {
  deps: AppDeps;
  run: ReturnType<typeof vi.fn>;
  listModels: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  append: ReturnType<typeof vi.fn>;
  recent: ReturnType<typeof vi.fn>;
}

function fakes(over: Partial<AppDeps> = {}): Fakes {
  const run = vi.fn(async () => RESULT);
  const listModels = vi.fn(async () => MODELS);
  const list = vi.fn(async (): Promise<SetSummary[]> => [
    { name: 'triage', questionCount: 1, valid: true },
  ]);
  const load = vi.fn(async () => SET);
  const save = vi.fn(async () => undefined);
  const append = vi.fn(async () => undefined);
  const recent = vi.fn(async (): Promise<HistoryRecord[]> => []);

  const sets = { dir: '/tmp/jev-sets', list, load, save } as unknown as SetsStore;
  const history = { file: '/tmp/jev-history.jsonl', append, recent } as unknown as HistoryStore;

  const deps: AppDeps = {
    run: run as unknown as AppDeps['run'],
    listModels: listModels as unknown as AppDeps['listModels'],
    sets,
    history,
    keyConfigured: () => true,
    version: '9.9.9',
    getPort: () => 4173,
    ...over,
  };
  return { deps, run, listModels, list, load, save, append, recent };
}

async function request(app: Hono, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = { host: HOST, ...((init.headers ?? {}) as Record<string, string>) };
  return await app.request(url, { ...init, headers });
}

function postJson(app: Hono, url: string, body: unknown): Promise<Response> {
  return request(app, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/health', () => {
  it('returns exactly keyConfigured, version and setsDir', async () => {
    const { deps } = fakes();
    const res = await request(createApp(deps), '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      keyConfigured: true,
      version: '9.9.9',
      setsDir: '/tmp/jev-sets',
    });
  });

  it('never serialises the API key', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-fake-key-abcdef123456');
    const { deps } = fakes();
    const res = await request(createApp(deps), '/api/health');
    expect(await res.text()).not.toContain('ts-fake-key-abcdef123456');
  });
});

describe('GET /api/models', () => {
  it('returns the model list', async () => {
    const { deps, listModels } = fakes();
    const res = await request(createApp(deps), '/api/models');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(MODELS);
    expect(listModels).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/run', () => {
  it('runs the request and appends a history record with the result', async () => {
    const { deps, run, append } = fakes();
    const res = await postJson(createApp(deps), '/api/run', {
      request: REQUEST,
      setName: 'triage',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RESULT);
    expect(run).toHaveBeenCalledWith(REQUEST);
    expect(append).toHaveBeenCalledTimes(1);
    const record = append.mock.calls[0]?.[0] as HistoryRecord;
    expect(record.request).toEqual(REQUEST);
    expect(record.result).toEqual(RESULT);
    expect(record.setName).toBe('triage');
    expect(record.error).toBeUndefined();
    expect(Number.isNaN(Date.parse(record.ts))).toBe(false);
  });

  it('maps a rejected run to its status and appends the error to history', async () => {
    const { deps, append } = fakes();
    (deps.run as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new JevError('validation', 'criteria required', { path: 'questions.q.criteria' }),
    );
    const res = await postJson(createApp(deps), '/api/run', { request: REQUEST });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { kind: 'validation', message: 'criteria required', path: 'questions.q.criteria' },
    });
    const record = append.mock.calls[0]?.[0] as HistoryRecord;
    expect(record.error).toEqual({ kind: 'validation', message: 'criteria required' });
    expect(record.result).toBeUndefined();
  });

  const kinds: [JevErrorKind, number][] = [
    ['noKey', 503],
    ['auth', 502],
    ['validation', 422],
    ['rateLimit', 429],
    ['overloaded', 502],
    ['timeout', 504],
    ['network', 502],
    ['unexpected', 500],
  ];
  it.each(kinds)('maps a %s failure to %i', async (kind, status) => {
    const { deps } = fakes();
    (deps.run as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new JevError(kind, 'boom'),
    );
    const res = await postJson(createApp(deps), '/api/run', { request: REQUEST });
    expect(res.status).toBe(status);
  });

  it('rejects an invalid request with a path relative to the request document', async () => {
    const { deps, run, append } = fakes();
    const res = await postJson(createApp(deps), '/api/run', {
      request: { state: 's', questions: { q: { type: 'noul' } } },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { kind: string; path?: string } };
    expect(body.error.kind).toBe('validation');
    expect(body.error.path).toBe('questions.q.instructions');
    expect(run).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('rejects an empty request object without calling run', async () => {
    const { deps, run } = fakes();
    const res = await postJson(createApp(deps), '/api/run', { request: {} });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { kind: string; path?: string } };
    expect(body.error.kind).toBe('validation');
    expect(body.error.path?.startsWith('request')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a non-string setName', async () => {
    const { deps, run } = fakes();
    const res = await postJson(createApp(deps), '/api/run', { request: REQUEST, setName: 7 });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { kind: string; path?: string } };
    expect(body.error.path).toBe('setName');
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON body', async () => {
    const { deps, run, append } = fakes();
    const res = await request(createApp(deps), '/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json at all',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { kind: 'validation', message: 'invalid JSON body' },
    });
    expect(run).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
});

describe('sets routes', () => {
  it('lists sets', async () => {
    const { deps } = fakes();
    const res = await request(createApp(deps), '/api/sets');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ name: 'triage', questionCount: 1, valid: true }]);
  });

  it('loads one set', async () => {
    const { deps, load } = fakes();
    const res = await request(createApp(deps), '/api/sets/triage');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SET);
    expect(load).toHaveBeenCalledWith('triage');
  });

  it('maps a bad set name to 400', async () => {
    const { deps, load } = fakes();
    load.mockRejectedValueOnce(new SetError('badName', 'Invalid set name: ..'));
    const res = await request(createApp(deps), '/api/sets/nope');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { kind: 'validation', message: 'Invalid set name: ..' },
    });
  });

  it('maps a missing set to 404', async () => {
    const { deps, load } = fakes();
    load.mockRejectedValueOnce(new SetError('notFound', 'Question set not found: triage.json'));
    const res = await request(createApp(deps), '/api/sets/triage');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe('validation');
  });

  it('saves a set under the URL name and answers 204 with no body', async () => {
    const { deps, save } = fakes();
    const res = await request(createApp(deps), '/api/sets/renamed', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SET),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(save).toHaveBeenCalledWith('renamed', SET);
  });

  it('rejects an invalid set body with 422 and does not save', async () => {
    const { deps, save } = fakes();
    const res = await request(createApp(deps), '/api/sets/triage', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'triage', questions: { q: { type: 'noul' } } }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { kind: string; path?: string } };
    expect(body.error.kind).toBe('validation');
    expect(body.error.path).toBe('questions.q.instructions');
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON set body with 422', async () => {
    const { deps, save } = fakes();
    const res = await request(createApp(deps), '/api/sets/triage', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { kind: 'validation', message: 'invalid JSON body' },
    });
    expect(save).not.toHaveBeenCalled();
  });
});

describe('GET /api/history', () => {
  it.each([
    ['?limit=9999', 200],
    ['?limit=abc', 20],
    ['', 20],
    ['?limit=0', 1],
    ['?limit=5', 5],
  ])('clamps %s to %i', async (query, expected) => {
    const { deps, recent } = fakes();
    const res = await request(createApp(deps), `/api/history${query}`);
    expect(res.status).toBe(200);
    expect(recent).toHaveBeenCalledWith(expected);
  });

  it('returns the records', async () => {
    const { deps, recent } = fakes();
    const record: HistoryRecord = { ts: '2026-09-21T00:00:00.000Z', request: REQUEST };
    recent.mockResolvedValueOnce([record]);
    const res = await request(createApp(deps), '/api/history');
    expect(await res.json()).toEqual([record]);
  });
});

describe('errors', () => {
  it('turns an unknown failure into a 500 that leaks nothing', async () => {
    const { deps, list } = fakes();
    list.mockRejectedValueOnce(new Error('secret upstream detail'));
    const res = await request(createApp(deps), '/api/sets');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret upstream detail');
    expect(JSON.parse(text)).toEqual({
      error: { kind: 'unexpected', message: 'internal error' },
    });
  });

  it('answers an unknown /api route with 404 JSON', async () => {
    const { deps } = fakes();
    const res = await request(createApp(deps), '/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { kind: 'unexpected', message: 'not found' },
    });
  });
});

describe('guard', () => {
  it('rejects a foreign host before any route runs', async () => {
    const { deps, listModels } = fakes();
    const res = await createApp(deps).request('/api/models', { headers: { host: 'evil.com' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { kind: 'unexpected', message: 'forbidden host' },
    });
    expect(listModels).not.toHaveBeenCalled();
  });

  it('rejects an unknown path on a foreign host too', async () => {
    const { deps } = fakes();
    const res = await createApp(deps).request('/anything', { headers: { host: 'evil.com' } });
    expect(res.status).toBe(403);
  });

  it('rejects a foreign origin', async () => {
    const { deps } = fakes();
    const res = await request(createApp(deps), '/api/health', {
      headers: { origin: 'https://evil.com' },
    });
    expect(res.status).toBe(403);
  });

  it('allows the server own origin', async () => {
    const { deps } = fakes();
    const res = await request(createApp(deps), '/api/health', {
      headers: { origin: 'http://localhost:4173' },
    });
    expect(res.status).toBe(200);
  });

  it('never emits a CORS header', async () => {
    const { deps } = fakes();
    const app = createApp(deps);
    for (const res of [
      await request(app, '/api/health'),
      await createApp(deps).request('/api/health', { headers: { host: 'evil.com' } }),
    ]) {
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });
});

describe('static hosting', () => {
  let webDir: string;

  beforeAll(async () => {
    webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-web-'));
    await fs.writeFile(path.join(webDir, 'index.html'), '<!doctype html><title>Jev UI</title>');
    await fs.mkdir(path.join(webDir, 'assets'));
    await fs.writeFile(path.join(webDir, 'assets', 'app.js'), 'export const ok = 1;');
  });

  afterAll(async () => {
    await fs.rm(webDir, { recursive: true, force: true });
  });

  it('returns a plain-text hint at / when there is no web build', async () => {
    const { deps } = fakes();
    const res = await request(createApp(deps), '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toMatch(/web/i);
  });

  it('serves index.html at /', async () => {
    const { deps } = fakes({ webDir });
    const res = await request(createApp(deps), '/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Jev UI');
  });

  it('serves a static asset', async () => {
    const { deps } = fakes({ webDir });
    const res = await request(createApp(deps), '/assets/app.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('export const ok');
  });

  it('falls back to index.html for an unknown page', async () => {
    const { deps } = fakes({ webDir });
    const res = await request(createApp(deps), '/workbench/deep/link');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Jev UI');
  });

  it('never falls back to the SPA for an unknown /api route', async () => {
    const { deps } = fakes({ webDir });
    const res = await request(createApp(deps), '/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { kind: 'unexpected', message: 'not found' },
    });
  });

  it.each(['/../../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json'])(
    'never serves %s from outside the web dir',
    async (url) => {
      const { deps } = fakes({ webDir });
      const res = await request(createApp(deps), url);
      expect(await res.text()).not.toContain('"@jev-ui/server"');
    },
  );
});
