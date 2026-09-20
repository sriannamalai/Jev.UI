import { expect, test } from 'vitest';
import {
  addQuestion,
  blankQuestion,
  deleteQuestion,
  duplicateQuestion,
  moveQuestion,
  newRequest,
  QUESTION_ID_RE,
  questionIds,
  renameQuestion,
  uniqueId,
  updateQuestion,
} from '../src/doc.js';
import type { Question, Request } from '../src/schema.js';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function baseRequest(): Request {
  return {
    state: 'hello',
    model: 'jev-latest',
    questions: {
      a: { type: 'noul', instructions: 'a?' },
      b: { type: 'noul', instructions: 'b?' },
      c: { type: 'noul', instructions: 'c?' },
    },
  };
}

test('newRequest gives a blank state and one blank noul question', () => {
  const req = newRequest();
  expect(req.state).toBe('');
  expect(req.model).toBe('jev-latest');
  expect(Object.keys(req.questions)).toEqual(['question_1']);
  expect(req.questions.question_1).toEqual({ type: 'noul', instructions: '' });
});

test('blankQuestion(noul) has no criteria key at all', () => {
  const q = blankQuestion('noul');
  expect(q).toEqual({ type: 'noul', instructions: '' });
  expect('criteria' in q).toBe(false);
});

test('blankQuestion(choice) has two null options', () => {
  expect(blankQuestion('choice')).toEqual({
    type: 'choice',
    instructions: '',
    criteria: { option_1: null, option_2: null },
  });
});

test('blankQuestion(score) has two blank criteria', () => {
  expect(blankQuestion('score')).toEqual({
    type: 'score',
    instructions: '',
    criteria: ['', ''],
  });
});

test('uniqueId returns base when free', () => {
  const req = baseRequest();
  expect(uniqueId(req, 'd')).toBe('d');
});

test('uniqueId appends _2, _3 for a taken base', () => {
  const req: Request = {
    state: '',
    questions: { d: blankQuestion('noul'), d_2: blankQuestion('noul') },
  };
  expect(uniqueId(req, 'd')).toBe('d_3');
});

test('addQuestion appends noul_1, then noul_2', () => {
  const req = deepFreeze(baseRequest());
  const first = addQuestion(req, 'noul');
  expect(first.id).toBe('noul_1');
  const second = addQuestion(first.request, 'noul');
  expect(second.id).toBe('noul_2');
  expect(Object.keys(second.request.questions)).toEqual(['a', 'b', 'c', 'noul_1', 'noul_2']);
});

test('addQuestion works for choice and score too', () => {
  const req = deepFreeze(baseRequest());
  expect(addQuestion(req, 'choice').id).toBe('choice_1');
  expect(addQuestion(req, 'score').id).toBe('score_1');
});

test('updateQuestion replaces value and preserves position', () => {
  const req = deepFreeze(baseRequest());
  const q: Question = { type: 'noul', instructions: 'updated' };
  const next = updateQuestion(req, 'b', q);
  expect(Object.keys(next.questions)).toEqual(['a', 'b', 'c']);
  expect(next.questions.b).toEqual(q);
});

test('deleteQuestion removes the given id', () => {
  const req = deepFreeze(baseRequest());
  const next = deleteQuestion(req, 'b');
  expect(Object.keys(next.questions)).toEqual(['a', 'c']);
});

test('deleteQuestion of the last remaining question is a no-op returning the same request', () => {
  const req = deepFreeze<Request>({ state: '', questions: { only: blankQuestion('noul') } });
  const next = deleteQuestion(req, 'only');
  expect(next).toBe(req);
});

test('duplicateQuestion inserts directly after source with id <src>_copy', () => {
  const req = deepFreeze(baseRequest());
  const { request, id } = duplicateQuestion(req, 'b');
  expect(id).toBe('b_copy');
  expect(Object.keys(request.questions)).toEqual(['a', 'b', 'b_copy', 'c']);
  expect(request.questions.b_copy).toEqual(req.questions.b);
});

test('moveQuestion at the edges is a no-op', () => {
  const req = deepFreeze(baseRequest());
  expect(moveQuestion(req, 'a', -1)).toBe(req);
  expect(moveQuestion(req, 'c', 1)).toBe(req);
});

test('moveQuestion(r, "b", -1) on {a,b,c} yields order [b,a,c]', () => {
  const req = deepFreeze(baseRequest());
  const next = moveQuestion(req, 'b', -1);
  expect(Object.keys(next.questions)).toEqual(['b', 'a', 'c']);
});

test('renameQuestion preserves position', () => {
  const req = deepFreeze(baseRequest());
  const result = renameQuestion(req, 'b', 'renamed');
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(Object.keys(result.request.questions)).toEqual(['a', 'renamed', 'c']);
  }
});

test('renameQuestion to an existing id fails with duplicate', () => {
  const req = deepFreeze(baseRequest());
  expect(renameQuestion(req, 'a', 'b')).toEqual({ ok: false, reason: 'duplicate' });
});

test('renameQuestion to "1abc" fails with invalid', () => {
  const req = deepFreeze(baseRequest());
  expect(renameQuestion(req, 'a', '1abc')).toEqual({ ok: false, reason: 'invalid' });
});

test('QUESTION_ID_RE accepts valid ids and rejects leading digits', () => {
  expect(QUESTION_ID_RE.test('is_urgent')).toBe(true);
  expect(QUESTION_ID_RE.test('1abc')).toBe(false);
});

test('questionIds returns keys in order', () => {
  const req = deepFreeze(baseRequest());
  expect(questionIds(req)).toEqual(['a', 'b', 'c']);
});

test('no function mutates its (frozen) input', () => {
  const req = deepFreeze(baseRequest());
  expect(() => {
    addQuestion(req, 'noul');
    updateQuestion(req, 'a', blankQuestion('noul'));
    deleteQuestion(req, 'a');
    duplicateQuestion(req, 'a');
    moveQuestion(req, 'a', 1);
    renameQuestion(req, 'a', 'z');
    questionIds(req);
    uniqueId(req, 'a');
  }).not.toThrow();
});
