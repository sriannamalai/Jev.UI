import { JevError, SetError, type ErrorBody, type JevErrorKind } from '@jev-ui/core';

const STATUS_BY_KIND: Record<JevErrorKind, number> = {
  noKey: 503,
  auth: 502,
  validation: 422,
  rateLimit: 429,
  overloaded: 502,
  timeout: 504,
  network: 502,
  unexpected: 500,
};

export function statusFor(kind: JevErrorKind): number {
  return STATUS_BY_KIND[kind];
}

const SET_ERROR_STATUS: Record<SetError['code'], number> = {
  badName: 400,
  notFound: 404,
  invalid: 422,
};

export function toErrorResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof JevError) {
    return {
      status: statusFor(err.kind),
      body: { error: { kind: err.kind, message: err.message, path: err.path } },
    };
  }

  if (err instanceof SetError) {
    return {
      status: SET_ERROR_STATUS[err.code],
      body: { error: { kind: 'validation', message: err.message, path: err.path } },
    };
  }

  return { status: 500, body: { error: { kind: 'unexpected', message: 'internal error' } } };
}
