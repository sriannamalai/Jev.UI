import { expect, test } from 'vitest';
import { mapUpstreamLoc } from '../src/errors.js';

test('drops body and the type tag', () =>
  expect(mapUpstreamLoc(['body', 'questions', 'q', 'score', 'criteria'])).toBe(
    'questions.q.criteria',
  ));

test('keeps array indexes', () =>
  expect(mapUpstreamLoc(['body', 'questions', 'q', 'score', 'criteria', 2])).toBe(
    'questions.q.criteria[2]',
  ));

test('a question literally named "score" is preserved', () =>
  expect(mapUpstreamLoc(['body', 'questions', 'score', 'noul', 'instructions'])).toBe(
    'questions.score.instructions',
  ));

test('empty / body-only loc is undefined', () => expect(mapUpstreamLoc(['body'])).toBeUndefined());
