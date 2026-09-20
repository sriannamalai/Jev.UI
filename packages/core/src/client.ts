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

function buildClient(opts?: ClientOptions): TypeSafeClient {
  const apiKey = resolveApiKey(opts?.apiKey, process.env);
  if (apiKey === undefined) {
    throw new JevError('noKey', 'No TypeSafe API key was provided.');
  }
  const config: TypeSafeClientConfig = { apiKey };
  if (opts?.fetch !== undefined) config.fetch = opts.fetch;
  if (opts?.baseURL !== undefined) config.baseURL = opts.baseURL;
  if (opts?.maxRetries !== undefined) config.retry = { maxRetries: opts.maxRetries };
  return new TypeSafeClient(config);
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

/** Map an error from the SDK call to a `JevError`, or rethrow an abort as-is. */
function mapError(err: unknown): never {
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
  throw new JevError('unexpected', err instanceof Error ? err.message : 'Unknown error');
}

/** Run `fn`, normalising any rejection into a `JevError` (or rethrowing an abort as-is). */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return mapError(err);
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

export async function run(request: Request, opts?: ClientOptions): Promise<RunResult> {
  const client = buildClient(opts);
  const now = opts?.now ?? (() => performance.now());
  const start = now();

  const result = await guarded(() =>
    client.systemOne(request as unknown as SystemOneRequest<Questions>, { signal: opts?.signal }),
  );

  const latencyMs = now() - start;
  const answers = parseAnswers(result.answers as Record<string, unknown>);

  return {
    answers,
    model: result.model,
    usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
    latencyMs,
    costUsd: costUsd(result.usage.input_tokens),
  };
}

export async function listModels(opts?: ClientOptions): Promise<ModelInfo[]> {
  const client = buildClient(opts);
  const models = await guarded(() => client.models.list({ signal: opts?.signal }));
  return models.map((m) => ({
    name: m.name,
    description: m.description,
    releaseDate: m.release_date,
  }));
}
