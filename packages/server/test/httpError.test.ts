import { JevError, SetError, type JevErrorKind } from '@jev-ui/core';
import { describe, expect, it } from 'vitest';
import { statusFor, toErrorResponse } from '../src/httpError.js';

describe('statusFor', () => {
  const table: Record<JevErrorKind, number> = {
    noKey: 503,
    auth: 502,
    validation: 422,
    rateLimit: 429,
    overloaded: 502,
    timeout: 504,
    network: 502,
    unexpected: 500,
  };

  for (const [kind, status] of Object.entries(table) as [JevErrorKind, number][]) {
    it(`maps ${kind} to ${status}`, () => {
      expect(statusFor(kind)).toBe(status);
    });
  }
});

describe('toErrorResponse', () => {
  it('maps a JevError to its status and body', () => {
    const err = new JevError('rateLimit', 'slow down');
    const { status, body } = toErrorResponse(err);
    expect(status).toBe(429);
    expect(body).toEqual({ error: { kind: 'rateLimit', message: 'slow down', path: undefined } });
  });

  it('keeps the path on a validation JevError', () => {
    const err = new JevError('validation', 'bad field', { path: 'questions[0].prompt' });
    const { status, body } = toErrorResponse(err);
    expect(status).toBe(422);
    expect(body.error.path).toBe('questions[0].prompt');
  });

  it('maps SetError badName to 400 validation', () => {
    const err = new SetError('badName', 'Invalid set name: ../x');
    const { status, body } = toErrorResponse(err);
    expect(status).toBe(400);
    expect(body).toEqual({
      error: { kind: 'validation', message: 'Invalid set name: ../x', path: undefined },
    });
  });

  it('maps SetError notFound to 404 validation', () => {
    const err = new SetError('notFound', 'Question set not found: foo.json');
    const { status, body } = toErrorResponse(err);
    expect(status).toBe(404);
    expect(body.error.kind).toBe('validation');
  });

  it('maps SetError invalid to 422 validation and keeps the path', () => {
    const err = new SetError('invalid', 'Invalid question set', { path: 'name' });
    const { status, body } = toErrorResponse(err);
    expect(status).toBe(422);
    expect(body).toEqual({
      error: { kind: 'validation', message: 'Invalid question set', path: 'name' },
    });
  });

  it('maps an unknown error to 500 without echoing its message', () => {
    const err = new Error('secret detail');
    const { status, body } = toErrorResponse(err);
    expect(status).toBe(500);
    expect(body).toEqual({ error: { kind: 'unexpected', message: 'internal error' } });
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });

  it('maps a non-Error thrown value to 500 without echoing it', () => {
    const { status, body } = toErrorResponse('secret string');
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret string');
  });
});
