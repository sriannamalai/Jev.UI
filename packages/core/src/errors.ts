export type JevErrorKind =
  | 'noKey'
  | 'auth'
  | 'validation'
  | 'rateLimit'
  | 'overloaded'
  | 'timeout'
  | 'network'
  | 'unexpected';

export class JevError extends Error {
  readonly kind: JevErrorKind;
  readonly path?: string;
  readonly retryAfterMs?: number;
  readonly status?: number;

  constructor(
    kind: JevErrorKind,
    message: string,
    extra?: { path?: string; retryAfterMs?: number; status?: number },
  ) {
    super(message);
    this.name = 'JevError';
    this.kind = kind;
    this.path = extra?.path;
    this.retryAfterMs = extra?.retryAfterMs;
    this.status = extra?.status;
  }
}

const QUESTION_TYPE_TAGS = new Set(['noul', 'choice', 'score']);

export function mapUpstreamLoc(loc: readonly (string | number)[]): string | undefined {
  let segments = loc.length > 0 && loc[0] === 'body' ? loc.slice(1) : loc.slice();

  const tag = segments[2];
  if (segments[0] === 'questions' && typeof tag === 'string' && QUESTION_TYPE_TAGS.has(tag)) {
    segments = [...segments.slice(0, 2), ...segments.slice(3)];
  }

  if (segments.length === 0) return undefined;

  return segments.reduce<string>((acc, segment, index) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return index === 0 ? String(segment) : `${acc}.${segment}`;
  }, '');
}

export interface ErrorBody {
  error: { kind: JevErrorKind; message: string; path?: string };
}
