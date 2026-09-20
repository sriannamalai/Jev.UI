// The web app can never call the upstream TypeSafe API directly (CORS, and
// the API key lives only in the Node server). Every request here goes to a
// relative `/api/...` URL on the project's own localhost server.
import type {
  ErrorBody,
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

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  const { kind, message } = error as { kind?: unknown; message?: unknown };
  return typeof kind === 'string' && typeof message === 'string';
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

  if (!isErrorBody(parsed)) return unexpected();

  return new ApiError(parsed.error.kind, parsed.error.message, {
    path: parsed.error.path,
    status: response.status,
  });
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
