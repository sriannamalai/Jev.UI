import { serveStatic } from '@hono/node-server/serve-static';
import { QuestionSetSchema, RequestSchema, formatPath } from '@jev-ui/core';
import type {
  ErrorBody,
  HistoryRecord,
  HistoryStore,
  Request as JevRequest,
  RunResult,
  SetsStore,
  listModels,
  run,
} from '@jev-ui/core';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { hostGuard } from './guard.js';
import { toErrorResponse } from './httpError.js';

export interface AppDeps {
  run: typeof run;
  listModels: typeof listModels;
  sets: SetsStore;
  history: HistoryStore;
  keyConfigured(): boolean;
  version: string;
  getPort(): number;
  webDir?: string;
}

const NO_WEB_BUILD_HINT =
  'Jev UI server is running. No web build is present; the API is available under /api.\n';

// A request body larger than this is refused before it is read: the workbench's own documents are
// a few kilobytes, so anything at this size is a mistake or an attempt to exhaust memory.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const limitBody = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) =>
    c.json(
      { error: { kind: 'validation', message: 'request body too large' } } satisfies ErrorBody,
      413,
    ),
});

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 200;

/** Build the localhost API over the core modules, optionally hosting a built web app. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // First middleware: every route, including static files and unknown paths.
  app.use('*', hostGuard(deps.getPort));

  app.onError((err, c) => fail(c, err));

  app.get('/api/health', (c) =>
    c.json({
      keyConfigured: deps.keyConfigured(),
      version: deps.version,
      setsDir: deps.sets.dir,
    }),
  );

  app.get('/api/models', async (c) => c.json(await deps.listModels()));

  app.post('/api/run', limitBody, async (c) => {
    const body = await readJson(c);
    if (!body.ok) return invalid(c, body.message, body.path);

    const parsed = parseRunBody(body.value);
    if (!parsed.ok) return invalid(c, parsed.message, parsed.path);

    const { request, setName } = parsed;
    const ts = new Date().toISOString();

    let result: RunResult;
    try {
      result = await deps.run(request);
    } catch (err) {
      const { status, body: errorBody } = toErrorResponse(err);
      await record(deps.history, {
        ts,
        request,
        error: { kind: errorBody.error.kind, message: errorBody.error.message },
        ...(setName === undefined ? {} : { setName }),
      });
      return c.json(errorBody, status as ContentfulStatusCode);
    }

    await record(deps.history, {
      ts,
      request,
      result,
      ...(setName === undefined ? {} : { setName }),
    });
    return c.json(result);
  });

  app.get('/api/sets', async (c) => c.json(await deps.sets.list()));

  app.get('/api/sets/:name', async (c) => c.json(await deps.sets.load(c.req.param('name'))));

  app.put('/api/sets/:name', limitBody, async (c) => {
    const body = await readJson(c);
    if (!body.ok) return invalid(c, body.message, body.path);

    const parsed = QuestionSetSchema.safeParse(body.value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return invalid(c, issue?.message ?? 'invalid question set', pathOf(issue));
    }

    // `sets.save` forces the stored name to the URL's name.
    await deps.sets.save(c.req.param('name'), parsed.data);
    return c.body(null, 204);
  });

  app.get('/api/history', async (c) =>
    c.json(await deps.history.recent(historyLimit(c.req.query('limit')))),
  );

  // Unknown API routes are JSON 404s — never the SPA fallback below.
  app.all('/api/*', (c) =>
    c.json({ error: { kind: 'unexpected', message: 'not found' } } satisfies ErrorBody, 404),
  );

  if (deps.webDir === undefined) {
    app.get('/', (c) => c.text(NO_WEB_BUILD_HINT));
  } else {
    const root = deps.webDir;
    app.use('/*', serveStatic({ root }));
    app.get('*', serveStatic({ path: 'index.html', root }));
  }

  return app;
}

type JsonBody = { ok: true; value: unknown } | { ok: false; message: string; path?: string };

async function readJson(c: Context): Promise<JsonBody> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false, message: 'invalid JSON body' };
  }
}

type RunBody =
  | { ok: true; request: JevRequest; setName?: string }
  | { ok: false; message: string; path?: string };

function parseRunBody(value: unknown): RunBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'body must be an object' };
  }

  const { request, setName } = value as { request?: unknown; setName?: unknown };
  if (setName !== undefined && typeof setName !== 'string') {
    return { ok: false, message: 'setName must be a string', path: 'setName' };
  }

  const parsed = RequestSchema.safeParse(request);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? 'invalid request', path: pathOf(issue) };
  }

  return setName === undefined
    ? { ok: true, request: parsed.data }
    : { ok: true, request: parsed.data, setName };
}

function pathOf(issue: { path: readonly PropertyKey[] } | undefined): string | undefined {
  if (issue === undefined || issue.path.length === 0) return undefined;
  return formatPath(issue.path);
}

function historyLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(parsed)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(MAX_HISTORY_LIMIT, Math.max(1, Math.trunc(parsed)));
}

function invalid(c: Context, message: string, path?: string): Response {
  const body: ErrorBody = { error: { kind: 'validation', message, path } };
  return c.json(body, 422);
}

function fail(c: Context, err: unknown): Response {
  const { status, body } = toErrorResponse(err);
  return c.json(body, status as ContentfulStatusCode);
}

/** History is best-effort: `append` never throws, but a rejection must not fail the request. */
async function record(history: HistoryStore, entry: HistoryRecord): Promise<void> {
  try {
    await history.append(entry);
  } catch {
    // ignored on purpose — a run's result matters more than its log line
  }
}
