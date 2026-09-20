import { expect, test } from 'vitest';
import { DEFAULT_MODEL, type Request } from '../src/schema.js';
import { requestFromSet, setFromRequest, SET_NAME_RE } from '../src/set.js';

const request: Request = {
  state: 'a customer message',
  model: 'jev-latest',
  questions: {
    is_urgent: { type: 'noul', instructions: 'Is this urgent?' },
  },
};

test('round-trips setFromRequest -> requestFromSet', () => {
  const set = setFromRequest('support-triage', request);
  expect(requestFromSet(set)).toEqual(request);
});

test('applies defaults when set has no state/model', () => {
  const set = setFromRequest('bare', { state: '', questions: request.questions });
  expect(requestFromSet(set)).toEqual({
    state: '',
    model: DEFAULT_MODEL,
    questions: request.questions,
  });
});

test('overrides win over set state/model', () => {
  const set = setFromRequest('support-triage', request);
  expect(requestFromSet(set, { state: 'overridden state', model: 'jev-mini' })).toEqual({
    state: 'overridden state',
    model: 'jev-mini',
    questions: request.questions,
  });
});

test('SET_NAME_RE accepts valid names', () => {
  expect(SET_NAME_RE.test('support-triage')).toBe(true);
});

test('SET_NAME_RE rejects path traversal', () => {
  expect(SET_NAME_RE.test('../x')).toBe(false);
});

test('SET_NAME_RE rejects uppercase', () => {
  expect(SET_NAME_RE.test('A')).toBe(false);
});

test('SET_NAME_RE rejects empty string', () => {
  expect(SET_NAME_RE.test('')).toBe(false);
});

test('SET_NAME_RE rejects leading dot', () => {
  expect(SET_NAME_RE.test('.hidden')).toBe(false);
});
