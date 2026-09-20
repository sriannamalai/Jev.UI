import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
  UnprocessableEntityError,
} from '@typesafe-ai/sdk';
import type { Questions, SystemOneRequest, TypeSafeClientConfig } from '@typesafe-ai/sdk';
import { JevError, mapUpstreamLoc } from './errors.js';
import { costUsd } from './metrics.js';
import { AnswerSchema } from './schema.js';
import type { Answer, ModelInfo, Request, RunResult } from './schema.js';

export interface ClientOptions {
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  baseURL?: string;
  maxRetries?: number;
  now?: () => number;
}

/** Resolve the API key from an explicit value or the environment; trims, blank -> undefined. */
export function resolveApiKey(explicit?: string, env?: NodeJS.ProcessEnv): string | undefined {
  const fromExplicit = explicit?.trim();
  if (fromExplicit) return fromExplicit;
  const fromEnv = env?.TYPESAFE_API_KEY?.trim();
  return fromEnv ? fromEnv : undefined;
}

/**
 * Construct the SDK client. `noKey` is checked and thrown before this ever runs, so it precedes
 * any network call. A failure constructing the client itself (e.g. an invalid `maxRetries`) is a
 * caller configuration mistake, not a fixable request-shape problem — it's tagged `unexpected`
 * here, as a `JevError`, before it can reach `mapError`'s TypeSafeError case (see `mapError`),
 * which is reserved for `systemOne`'s own request-validation failures.
 */
function buildClient(opts?: ClientOptions): TypeSafeClient {
  const apiKey = resolveApiKey(opts?.apiKey, process.env);
  if (apiKey === undefined) {
    throw new JevError('noKey', 'No TypeSafe API key was provided.');
  }
  const config: TypeSafeClientConfig = {
    apiKey,
    // Deliberate exception to "only pass what was provided": pinned regardless of
    // `TYPESAFE_LOG_LEVEL`, because the SDK's `debug` level logs full request/response bodies
    // and a partially masked Authorization header, which would break "the key never appears in
    // a log line".
    logLevel: 'warn',
  };
  if (opts?.fetch !== undefined) config.fetch = opts.fetch;
  if (opts?.baseURL !== undefined) config.baseURL = opts.baseURL;
  if (opts?.maxRetries !== undefined) config.retry = { maxRetries: opts.maxRetries };
  try {
    return new TypeSafeClient(config);
  } catch (err) {
    throw new JevError('unexpected', err instanceof Error ? err.message : 'Unknown error');
  }
}

/** Extract `body.detail.message` when the body is `{ detail: { message } }`. */
function detailMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const detail = (body as Record<string, unknown>).detail;
  if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) return undefined;
  const message = (detail as Record<string, unknown>).message;
  return typeof message === 'string' ? message : undefined;
}

/** Extract the first entry of `body.detail` when the body is `{ detail: [...] }` (422 shape). */
function firstDetailEntry(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const detail = (body as Record<string, unknown>).detail;
  if (!Array.isArray(detail) || detail.length === 0) return undefined;
  const first: unknown = detail[0];
  return typeof first === 'object' && first !== null
    ? (first as Record<string, unknown>)
    : undefined;
}

/**
 * Map an error from an SDK call to a `JevError`, or rethrow an abort/JevError as-is.
 *
 * `preflightAsValidation` covers `systemOne`'s own synchronous pre-flight validation (empty
 * questions, a score question with fewer than two criteria), which throws the SDK's base
 * `TypeSafeError` (there's no dedicated subclass — confirmed in the SDK's compiled source). That
 * is a user-fixable request-shape mistake, so `run()` passes `preflightAsValidation: true` to map
 * it to `validation`. `listModels()` does not: a bare `TypeSafeError` there (e.g. the SDK's own
 * `unwrapModels` shape check) is not a request the caller can fix, so it falls through to
 * `unexpected`. `buildClient`'s own construction failures are already tagged as `JevError` before
 * they can reach here, so they're unaffected by this flag either way (see the first check below).
 */
function mapError(err: unknown, options?: { preflightAsValidation?: boolean }): never {
  if (err instanceof JevError) throw err;
  if (err instanceof APIUserAbortError) throw err;
  if (err instanceof APITimeoutError) throw new JevError('timeout', err.message);
  if (err instanceof APIConnectionError) throw new JevError('network', err.message);

  if (err instanceof RateLimitError) {
    const message = detailMessage(err.body) ?? `HTTP ${err.status}`;
    throw new JevError('rateLimit', message, {
      retryAfterMs: err.retryAfterMs,
      status: err.status,
    });
  }
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    const message = detailMessage(err.body) ?? `HTTP ${err.status}`;
    throw new JevError('auth', message, { status: err.status });
  }
  if (err instanceof UnprocessableEntityError) {
    const entry = firstDetailEntry(err.body);
    const msg = typeof entry?.msg === 'string' ? entry.msg : `HTTP ${err.status}`;
    const path = Array.isArray(entry?.loc)
      ? mapUpstreamLoc(entry.loc as (string | number)[])
      : undefined;
    throw new JevError('validation', msg, { path, status: err.status });
  }
  if (err instanceof BadRequestError) {
    const message = detailMessage(err.body) ?? `HTTP ${err.status}`;
    throw new JevError('validation', message, { status: err.status });
  }
  if (err instanceof APIError) {
    const message = detailMessage(err.body) ?? `HTTP ${err.status}`;
    if (err.status === 529) throw new JevError('overloaded', message, { status: err.status });
    throw new JevError('unexpected', message, { status: err.status });
  }
  if (options?.preflightAsValidation && err instanceof TypeSafeError) {
    throw new JevError('validation', err.message);
  }
  throw new JevError('unexpected', err instanceof Error ? err.message : 'Unknown error');
}

/** Run `fn`, normalising any rejection into a `JevError` (or rethrowing an abort as-is). */
async function guarded<T>(
  fn: () => Promise<T>,
  mapOptions?: { preflightAsValidation?: boolean },
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return mapError(err, mapOptions);
  }
}

function parseAnswers(raw: Record<string, unknown>): Record<string, Answer> {
  const answers: Record<string, Answer> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = AnswerSchema.safeParse(value);
    if (!parsed.success) {
      throw new JevError('unexpected', `Malformed answer for question "${key}".`);
    }
    answers[key] = parsed.data;
  }
  return answers;
}

interface RunEnvelope {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Validate the shape of a `systemOne` response. The SDK does no response validation of its own
 * (it hands back whatever JSON — or raw text, for a non-JSON body — the server returned), so a
 * malformed 200 must be caught here rather than throwing a raw `TypeError` deeper in `run()`, or
 * silently producing a nonsensical `RunResult` (e.g. `costUsd: NaN`). Never echoes the offending
 * value in the message — only names which field was wrong.
 */
function validateRunEnvelope(value: unknown): RunEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new JevError('unexpected', 'Upstream response is not a JSON object.');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.model !== 'string') {
    throw new JevError('unexpected', 'Upstream response is missing a string `model`.');
  }
  if (typeof v.answers !== 'object' || v.answers === null || Array.isArray(v.answers)) {
    throw new JevError('unexpected', 'Upstream response `answers` is not an object.');
  }
  if (typeof v.usage !== 'object' || v.usage === null || Array.isArray(v.usage)) {
    throw new JevError('unexpected', 'Upstream response is missing a `usage` object.');
  }
  const usage = v.usage as Record<string, unknown>;
  if (typeof usage.input_tokens !== 'number' || !Number.isFinite(usage.input_tokens)) {
    throw new JevError(
      'unexpected',
      'Upstream response `usage.input_tokens` is not a finite number.',
    );
  }
  if (typeof usage.output_tokens !== 'number' || !Number.isFinite(usage.output_tokens)) {
    throw new JevError(
      'unexpected',
      'Upstream response `usage.output_tokens` is not a finite number.',
    );
  }
  return {
    model: v.model,
    answers: v.answers as Record<string, unknown>,
    usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens },
  };
}

interface ModelCardEnvelope {
  name: string;
  description: string;
  release_date: string;
}

/** Validate that a `models.list()` response is an array of `{name, description, release_date}`. */
function validateModelCards(value: unknown): ModelCardEnvelope[] {
  if (!Array.isArray(value)) {
    throw new JevError('unexpected', 'Upstream response is not a list of models.');
  }
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new JevError('unexpected', `Upstream model at index ${index} is not an object.`);
    }
    const v = item as Record<string, unknown>;
    if (
      typeof v.name !== 'string' ||
      typeof v.description !== 'string' ||
      typeof v.release_date !== 'string'
    ) {
      throw new JevError(
        'unexpected',
        `Upstream model at index ${index} is missing a required string field.`,
      );
    }
    return { name: v.name, description: v.description, release_date: v.release_date };
  });
}

export async function run(request: Request, opts?: ClientOptions): Promise<RunResult> {
  const now = opts?.now ?? (() => performance.now());
  const start = now();

  const result = await guarded(
    () => {
      const client = buildClient(opts);
      return client.systemOne(request as unknown as SystemOneRequest<Questions>, {
        signal: opts?.signal,
      });
    },
    { preflightAsValidation: true },
  );

  const latencyMs = now() - start;
  const envelope = validateRunEnvelope(result);
  const answers = parseAnswers(envelope.answers);

  return {
    answers,
    model: envelope.model,
    usage: {
      inputTokens: envelope.usage.input_tokens,
      outputTokens: envelope.usage.output_tokens,
    },
    latencyMs,
    costUsd: costUsd(envelope.usage.input_tokens),
  };
}

export async function listModels(opts?: ClientOptions): Promise<ModelInfo[]> {
  const models = await guarded(() => {
    const client = buildClient(opts);
    return client.models.list({ signal: opts?.signal });
  });
  return validateModelCards(models).map((m) => ({
    name: m.name,
    description: m.description,
    releaseDate: m.release_date,
  }));
}
