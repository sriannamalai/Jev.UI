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

test('a trailing comma reports the line it is actually on, not the last matching bracket', () => {
  // Regression: the array's trailing comma is on line 2, but a ']' also
  // appears later (line 3, in "b"'s array) — a message/character-search
  // based line finder can be fooled into reporting line 3.
  const result = parseRequestJson('{\n  "a": [1, 2, ],\n  "b": [3, 4]\n}');
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.line).toBe(2);
  }
});

test('a huge run of unclosed brackets is reported as invalid without throwing', () => {
  const text = '['.repeat(200000);
  let result: ReturnType<typeof parseRequestJson> | undefined;
  expect(() => {
    result = parseRequestJson(text);
  }).not.toThrow();
  expect(result?.ok).toBe(false);
  if (result && !result.ok) {
    expect(result.line).toBeUndefined();
  }
});

test('a CRLF document reports the right line', () => {
  const result = parseRequestJson('{\r\n  "a": [1, 2, ],\r\n  "b": [3, 4]\r\n}');
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.line).toBe(2);
  }
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
