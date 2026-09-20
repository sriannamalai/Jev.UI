// The web app can never call the upstream TypeSafe API directly (CORS, and
// the API key lives only in the Node server). Every request here goes to a
// relative `/api/...` URL on the project's own localhost server.
import type {
  JevErrorKind,
  ModelInfo,
  QuestionSet,
  Request,
  RunResult,
  SetSummary,
} from '@jev-ui/core/browser';

export class ApiError extends Error {
  readonly kind: JevErrorKind;
  readonly path?: string;
  readonly status?: number;

  constructor(kind: JevErrorKind, message: string, extra?: { path?: string; status?: number }) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.path = extra?.path;
    this.status = extra?.status;
  }
}

// The eight kinds `JevError`/`ApiError` can carry (see @jev-ui/core's
// `errors.ts`). Defined once here, `satisfies` against the shared type, so
// that a future kind added in core — but not added to this list — fails
// typecheck below rather than silently decoding as a valid kind.
const KNOWN_ERROR_KINDS = [
  'noKey',
  'auth',
  'validation',
  'rateLimit',
  'overloaded',
  'timeout',
  'network',
  'unexpected',
] as const satisfies readonly JevErrorKind[];

// Exhaustiveness in the other direction: if `JevErrorKind` ever gains a
// member not present in `KNOWN_ERROR_KINDS`, this conditional type evaluates
// to `false` and assigning `true` to it fails to typecheck.
type _KnownErrorKindsAreExhaustive = JevErrorKind extends (typeof KNOWN_ERROR_KINDS)[number]
  ? true
  : false;
const _knownErrorKindsAreExhaustive: _KnownErrorKindsAreExhaustive = true;
void _knownErrorKindsAreExhaustive;

function isKnownErrorKind(value: unknown): value is JevErrorKind {
  return typeof value === 'string' && (KNOWN_ERROR_KINDS as readonly string[]).includes(value);
}

function decodeErrorBody(value: unknown, status: number): ApiError {
  const unexpected = () => new ApiError('unexpected', `HTTP ${status}`, { status });

  if (typeof value !== 'object' || value === null || !('error' in value)) return unexpected();
  const error = (value as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return unexpected();

  const { kind, message, path } = error as { kind?: unknown; message?: unknown; path?: unknown };

  // An untrustworthy message means the whole error body is untrustworthy —
  // fall back fully rather than pairing a possibly-wrong kind with a
  // synthetic message.
  if (typeof message !== 'string') return unexpected();

  const safeKind = isKnownErrorKind(kind) ? kind : 'unexpected';
  const safePath = typeof path === 'string' ? path : undefined;

  return new ApiError(safeKind, message, { path: safePath, status });
}

async function toApiError(response: Response): Promise<ApiError> {
  const unexpected = () =>
    new ApiError('unexpected', `HTTP ${response.status}`, { status: response.status });

  let text: string;
  try {
    text = await response.text();
  } catch {
    return unexpected();
  }

  if (text.length === 0) return unexpected();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unexpected();
  }

  return decodeErrorBody(parsed, response.status);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export function createApi(fetchImpl?: typeof fetch) {
  // Bind lazily: when no fetchImpl is injected, look up globalThis.fetch at
  // request time (not at createApi() call time) so tests that stub
  // globalThis.fetch after `api` is created still take effect.
  const doFetch: typeof fetch = (input, init) => (fetchImpl ?? globalThis.fetch)(input, init);

  async function send<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(path, {
        method,
        ...(body !== undefined
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new ApiError('network', 'Cannot reach the Jev.UI server');
    }

    if (!response.ok) {
      throw await toApiError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError('unexpected', `HTTP ${response.status}`, { status: response.status });
    }
  }

  return {
    health: () =>
      send<{ keyConfigured: boolean; version: string; setsDir: string }>('GET', '/api/health'),

    models: () => send<ModelInfo[]>('GET', '/api/models'),

    run: (request: Request, setName?: string, signal?: AbortSignal) =>
      send<RunResult>(
        'POST',
        '/api/run',
        setName === undefined ? { request } : { request, setName },
        signal,
      ),

    listSets: () => send<SetSummary[]>('GET', '/api/sets'),

    getSet: (name: string) => send<QuestionSet>('GET', `/api/sets/${encodeURIComponent(name)}`),

    putSet: (name: string, set: QuestionSet) =>
      send<void>('PUT', `/api/sets/${encodeURIComponent(name)}`, set),
  };
}

export const api = createApi();
