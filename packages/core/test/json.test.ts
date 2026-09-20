import { expect, test } from 'vitest';
import { parseRequestJson, serializeRequest } from '../src/json.js';
import type { Request } from '../src/schema.js';

const request: Request = {
  state: 'a customer message',
  model: 'jev-latest',
  questions: {
    is_urgent: { type: 'noul', instructions: 'Is this urgent?' },
  },
};

test('serializeRequest uses 2-space indent', () => {
  expect(serializeRequest(request)).toBe(JSON.stringify(request, null, 2));
});

test('parseRequestJson(serializeRequest(r)) round-trips', () => {
  const result = parseRequestJson(serializeRequest(request));
  expect(result).toEqual({ ok: true, request });
});

test('a missing value after a key reports the line of the syntax error', () => {
  const result = parseRequestJson('{\n  "state": \n}');
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.line).toBe(3);
  }
});

test('empty string is not valid JSON', () => {
  const result = parseRequestJson('');
  expect(result.ok).toBe(false);
});

test('valid JSON that fails the schema reports the failing path', () => {
  const bad = {
    state: '',
    questions: {
      q: { type: 'score', instructions: 'x', criteria: { low: 'a', high: 'b' } },
    },
  };
  const result = parseRequestJson(JSON.stringify(bad));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.path).toBe('questions.q.criteria');
  }
});
