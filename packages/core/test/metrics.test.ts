import { expect, test } from 'vitest';
import {
  costUsd,
  estimateStateBudget,
  estimateTokens,
  formatUsd,
  USD_PER_MTOK,
} from '../src/metrics.js';
import type { Request } from '../src/schema.js';

test('estimateTokens is ceil(len/4) for strings', () => {
  expect(estimateTokens('abcd')).toBe(1);
  expect(estimateTokens('abcde')).toBe(2);
});

test('estimateTokens stringifies non-string values', () => {
  expect(estimateTokens({ a: 1 })).toBe(Math.ceil(JSON.stringify({ a: 1 }).length / 4));
});

test('estimateStateBudget is state tokens plus the longest question', () => {
  const request: Request = {
    state: 'abcd',
    questions: {
      short: { type: 'noul', instructions: 'hi' },
      long: { type: 'noul', instructions: 'a much longer set of instructions here' },
    },
  };
  const expected =
    estimateTokens(request.state) +
    Math.max(estimateTokens(request.questions.short), estimateTokens(request.questions.long));
  expect(estimateStateBudget(request)).toBe(expected);
});

test('costUsd converts tokens to USD at USD_PER_MTOK per million', () => {
  expect(costUsd(425)).toBeCloseTo(0.00001785, 10);
  expect(USD_PER_MTOK).toBe(0.042);
});

test('formatUsd uses 6dp below a cent, else 4dp', () => {
  expect(formatUsd(0.00001785)).toBe('$0.000018');
  expect(formatUsd(1.5)).toBe('$1.5000');
});
