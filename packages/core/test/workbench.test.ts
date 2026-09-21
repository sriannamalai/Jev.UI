import { expect, test } from 'vitest';
import { blankQuestion, newRequest, questionIds } from '../src/doc.js';
import type { Question, QuestionSet, Request, RunResult } from '../src/schema.js';
import { requestFromSet } from '../src/set.js';
import {
  canRun,
  errorTarget,
  initialWorkbench,
  questionRunBlocker,
  requestToRun,
  runBlockers,
  workbenchReducer,
  type WorkbenchState,
} from '../src/workbench.js';

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

function frozenState(overrides?: Partial<WorkbenchState>): WorkbenchState {
  const state = initialWorkbench(baseRequest());
  return deepFreeze({ ...state, selectedId: 'b', ...overrides });
}

const runResult: RunResult = {
  answers: { a: { type: 'noul', noul: 1 } },
  model: 'jev-latest',
  usage: { inputTokens: 1, outputTokens: 1 },
  latencyMs: 1,
  costUsd: 0,
};

// --- initialWorkbench ---------------------------------------------------

test('initialWorkbench() uses newRequest() and selects its first question', () => {
  const s = initialWorkbench();
  expect(s.request).toEqual(newRequest());
  expect(s.selectedId).toBe('question_1');
  expect(s.setName).toBeUndefined();
  expect(s.dirty).toBe(false);
  expect(s.result).toBeUndefined();
  expect(s.stale).toBe(false);
  expect(s.running).toBe(false);
  expect(s.pendingRequest).toBeUndefined();
  expect(s.error).toBeUndefined();
});

test('initialWorkbench(request) uses the given request and selects its first id', () => {
  const req = baseRequest();
  const s = initialWorkbench(req);
  expect(s.request).toBe(req);
  expect(s.selectedId).toBe('a');
  expect(s.pendingRequest).toBeUndefined();
});

// --- request-changing actions: dirty / stale / error ---------------------

test('a request-changing action sets dirty:true', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'setModel', model: 'other-model' });
  expect(next.dirty).toBe(true);
});

test('a request-changing action marks stale:true when a result already exists', () => {
  const s = frozenState({ result: runResult, stale: false });
  const next = workbenchReducer(s, { type: 'setModel', model: 'other-model' });
  expect(next.stale).toBe(true);
});

test('a request-changing action leaves stale untouched when there is no result', () => {
  const s = frozenState({ result: undefined, stale: false });
  const next = workbenchReducer(s, { type: 'setModel', model: 'other-model' });
  expect(next.stale).toBe(false);
});

test('a request-changing action clears any existing error', () => {
  const s = frozenState({ error: { kind: 'validation', message: 'bad' } });
  const next = workbenchReducer(s, { type: 'setModel', model: 'other-model' });
  expect(next.error).toBeUndefined();
});

// --- setState / setModel no-ops ------------------------------------------

test('setState with a deep-equal string is a no-op (same state reference)', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'setState', state: s.request.state });
  expect(next).toBe(s);
});

test('setState with a deep-equal structured value is a no-op (compared via JSON.stringify)', () => {
  const s = frozenState({ request: { ...baseRequest(), state: { a: 1, b: [1, 2] } } });
  const next = workbenchReducer(s, { type: 'setState', state: { a: 1, b: [1, 2] } });
  expect(next).toBe(s);
});

test('setState with a different value is a request-changing action', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'setState', state: 'new state' });
  expect(next.request.state).toBe('new state');
  expect(next.dirty).toBe(true);
});

test('setModel with the same model is a no-op (same state reference)', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'setModel', model: s.request.model as string });
  expect(next).toBe(s);
});

// --- addQuestion / duplicateQuestion select the new id --------------------

test('addQuestion selects the newly created id', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'addQuestion', questionType: 'noul' });
  expect(next.selectedId).toBe('noul_1');
  expect(questionIds(next.request)).toContain('noul_1');
});

test('duplicateQuestion selects the new duplicate id', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'duplicateQuestion', id: 'b' });
  expect(next.selectedId).toBe('b_copy');
});

test('duplicateQuestion of an unknown id is a no-op (same state reference)', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'duplicateQuestion', id: 'does-not-exist' });
  expect(next).toBe(s);
});

// --- updateQuestion --------------------------------------------------------

test('updateQuestion with an unknown id is a no-op (same state reference)', () => {
  const s = frozenState();
  const q: Question = { type: 'noul', instructions: 'x' };
  const next = workbenchReducer(s, { type: 'updateQuestion', id: 'does-not-exist', question: q });
  expect(next).toBe(s);
});

test('updateQuestion of the inherited id "constructor" is a no-op (own-property check, not `in`)', () => {
  const s = frozenState();
  const q: Question = { type: 'noul', instructions: 'x' };
  const next = workbenchReducer(s, { type: 'updateQuestion', id: 'constructor', question: q });
  expect(next).toBe(s);
});

test('updateQuestion with a known id applies the change', () => {
  const s = frozenState();
  const q: Question = { type: 'noul', instructions: 'updated' };
  const next = workbenchReducer(s, { type: 'updateQuestion', id: 'b', question: q });
  expect(next.request.questions.b).toEqual(q);
  expect(next.dirty).toBe(true);
});

// --- deleteQuestion selection rules -----------------------------------------

test('deleteQuestion of the selected id selects the next question', () => {
  const s = frozenState({ selectedId: 'b' });
  const next = workbenchReducer(s, { type: 'deleteQuestion', id: 'b' });
  expect(next.selectedId).toBe('c');
});

test('deleteQuestion of the selected last question selects the previous one', () => {
  const s = frozenState({ selectedId: 'c' });
  const next = workbenchReducer(s, { type: 'deleteQuestion', id: 'c' });
  expect(next.selectedId).toBe('b');
});

test('deleteQuestion of a non-selected id leaves selection untouched', () => {
  const s = frozenState({ selectedId: 'a' });
  const next = workbenchReducer(s, { type: 'deleteQuestion', id: 'b' });
  expect(next.selectedId).toBe('a');
});

test('deleteQuestion of the last remaining question is a no-op (same state reference)', () => {
  const req: Request = { state: '', questions: { only: blankQuestion('noul') } };
  const s = deepFreeze(initialWorkbench(req));
  const next = workbenchReducer(s, { type: 'deleteQuestion', id: 'only' });
  expect(next).toBe(s);
});

// --- moveQuestion no-op at edges --------------------------------------------

test('moveQuestion at the start edge is a no-op (same state reference)', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'moveQuestion', id: 'a', delta: -1 });
  expect(next).toBe(s);
});

test('moveQuestion at the end edge is a no-op (same state reference)', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'moveQuestion', id: 'c', delta: 1 });
  expect(next).toBe(s);
});

test('moveQuestion applies the reorder and marks dirty', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'moveQuestion', id: 'b', delta: -1 });
  expect(questionIds(next.request)).toEqual(['b', 'a', 'c']);
  expect(next.dirty).toBe(true);
});

// --- renameQuestion ----------------------------------------------------------

test('a failed rename (duplicate target) is a no-op (same state reference)', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'renameQuestion', id: 'a', newId: 'b' });
  expect(next).toBe(s);
});

test('a failed rename (invalid id) is a no-op (same state reference)', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'renameQuestion', id: 'a', newId: '1abc' });
  expect(next).toBe(s);
});

test('renameQuestion of the selected id keeps it selected under the new id', () => {
  const s = frozenState({ selectedId: 'b' });
  const next = workbenchReducer(s, { type: 'renameQuestion', id: 'b', newId: 'renamed' });
  expect(next.selectedId).toBe('renamed');
  expect(questionIds(next.request)).toEqual(['a', 'renamed', 'c']);
});

test('renameQuestion of a non-selected id leaves selection untouched', () => {
  const s = frozenState({ selectedId: 'a' });
  const next = workbenchReducer(s, { type: 'renameQuestion', id: 'b', newId: 'renamed' });
  expect(next.selectedId).toBe('a');
});

// --- select --------------------------------------------------------------

test('select highlights the given id and does not touch other fields', () => {
  const s = frozenState({ selectedId: 'a' });
  const next = workbenchReducer(s, { type: 'select', id: 'c' });
  expect(next.selectedId).toBe('c');
  expect(next.dirty).toBe(s.dirty);
  expect(next.request).toBe(s.request);
});

test('select with the already-selected id is a no-op (same state reference)', () => {
  const s = frozenState({ selectedId: 'a' });
  const next = workbenchReducer(s, { type: 'select', id: 'a' });
  expect(next).toBe(s);
});

// --- loadSet ---------------------------------------------------------------

test('loadSet loads the set via requestFromSet, resets run state, and selects the first id', () => {
  const set: QuestionSet = {
    name: 'my-set',
    questions: { x: blankQuestion('noul'), y: blankQuestion('noul') },
    state: 'set state',
  };
  const s = frozenState({
    result: runResult,
    error: { kind: 'validation', message: 'bad' },
    dirty: true,
    stale: true,
    running: true,
  });
  const next = workbenchReducer(s, { type: 'loadSet', set });
  expect(next.request).toEqual(requestFromSet(set));
  expect(next.selectedId).toBe('x');
  expect(next.setName).toBe('my-set');
  expect(next.dirty).toBe(false);
  expect(next.stale).toBe(false);
  expect(next.running).toBe(false);
  expect(next.result).toBeUndefined();
  expect(next.error).toBeUndefined();
});

// --- saved -------------------------------------------------------------------

test('saved sets setName and clears dirty', () => {
  const s = frozenState({ dirty: true, setName: undefined });
  const next = workbenchReducer(s, { type: 'saved', name: 'my-set' });
  expect(next.setName).toBe('my-set');
  expect(next.dirty).toBe(false);
});

// --- replaceRequest ----------------------------------------------------------

test('replaceRequest keeps selectedId when it still exists in the new request', () => {
  const s = frozenState({ selectedId: 'b' });
  const replacement: Request = { ...baseRequest(), state: 'replaced' };
  const next = workbenchReducer(s, { type: 'replaceRequest', request: replacement });
  expect(next.selectedId).toBe('b');
  expect(next.request).toBe(replacement);
});

test('replaceRequest selects the first id when the previous selection is gone', () => {
  const s = frozenState({ selectedId: 'b' });
  const replacement: Request = {
    state: 'replaced',
    questions: { x: blankQuestion('noul'), y: blankQuestion('noul') },
  };
  const next = workbenchReducer(s, { type: 'replaceRequest', request: replacement });
  expect(next.selectedId).toBe('x');
});

test('replaceRequest with a deep-equal request is a no-op (same state reference)', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'replaceRequest', request: baseRequest() });
  expect(next).toBe(s);
});

// --- run lifecycle -------------------------------------------------------------

test('canRun is true for a valid, non-running request', () => {
  const s = frozenState();
  expect(canRun(s)).toBe(true);
});

test('canRun is false while running', () => {
  const s = frozenState({ running: true });
  expect(canRun(s)).toBe(false);
});

test('canRun is false for an invalid request', () => {
  const s = frozenState({ request: { state: '', questions: {} } });
  expect(canRun(s)).toBe(false);
});

// --- run blockers: the API rejects a question with neither instructions nor criteria ----

test('canRun is false for the blank starting request', () => {
  expect(canRun(initialWorkbench())).toBe(false);
});

test('canRun becomes true once the blank question has instructions', () => {
  const s = initialWorkbench();
  const next = workbenchReducer(s, {
    type: 'updateQuestion',
    id: 'question_1',
    question: { type: 'noul', instructions: 'Is this urgent?' },
  });
  expect(canRun(next)).toBe(true);
});

test('runBlockers names each question that has neither instructions nor criteria', () => {
  expect(runBlockers(newRequest())).toEqual([
    { id: 'question_1', message: 'Add instructions or criteria to "question_1"' },
  ]);
  expect(runBlockers(baseRequest())).toEqual([]);
});

test('a noul question with empty instructions but a true-criterion is runnable', () => {
  const q: Question = { type: 'noul', instructions: '   ', criteria: { true: 'clearly urgent' } };
  expect(questionRunBlocker(q)).toBeUndefined();
});

test('a noul question with both criteria sides empty is blocked', () => {
  const q: Question = { type: 'noul', instructions: '', criteria: { true: '', false: '' } };
  expect(questionRunBlocker(q)).toBe('Add instructions or criteria');
});

test('a choice question with all-null descriptions but instructions is runnable', () => {
  const q: Question = {
    type: 'choice',
    instructions: 'Pick one',
    criteria: { option_1: null, option_2: null },
  };
  expect(questionRunBlocker(q)).toBeUndefined();
});

test('a score question with empty levels and empty instructions is blocked', () => {
  const q: Question = { type: 'score', instructions: '', criteria: ['', ''] };
  expect(questionRunBlocker(q)).toBe('Add instructions or criteria');
});

test('structured instructions count as non-empty', () => {
  const q: Question = { type: 'noul', instructions: { ask: 'is it urgent' } };
  expect(questionRunBlocker(q)).toBeUndefined();
});

test('runStart sets running:true and clears error', () => {
  const s = frozenState({ error: { kind: 'validation', message: 'bad' } });
  const next = workbenchReducer(s, { type: 'runStart' });
  expect(next.running).toBe(true);
  expect(next.error).toBeUndefined();
});

test('runStart snapshots the current request into pendingRequest', () => {
  const s = frozenState();
  const next = workbenchReducer(s, { type: 'runStart' });
  expect(next.pendingRequest).toBe(s.request);
});

test('runStart is ignored (same state reference) when the request cannot run', () => {
  const s = frozenState({ request: { state: '', questions: {} } });
  const next = workbenchReducer(s, { type: 'runStart' });
  expect(next).toBe(s);
});

test('runOk with no edit during the run sets result and stale:false, running:false', () => {
  const started = workbenchReducer(frozenState({ stale: true }), { type: 'runStart' });
  const next = workbenchReducer(started, { type: 'runOk', result: runResult });
  expect(next.result).toBe(runResult);
  expect(next.stale).toBe(false);
  expect(next.running).toBe(false);
  expect(next.pendingRequest).toBeUndefined();
});

test('a request edit that lands while running marks the runOk result stale', () => {
  const started = workbenchReducer(frozenState(), { type: 'runStart' });
  const edited = workbenchReducer(started, { type: 'setModel', model: 'other-model' });
  const next = workbenchReducer(edited, { type: 'runOk', result: runResult });
  expect(next.stale).toBe(true);
  expect(next.result).toBe(runResult);
  expect(next.dirty).toBe(true);
});

test('a no-op edit while running does not mark the runOk result stale', () => {
  const started = workbenchReducer(frozenState(), { type: 'runStart' });
  const edited = workbenchReducer(started, { type: 'moveQuestion', id: 'a', delta: -1 });
  expect(edited.request).toBe(started.request);
  const next = workbenchReducer(edited, { type: 'runOk', result: runResult });
  expect(next.stale).toBe(false);
});

test('runOk is ignored (same state reference) when not running', () => {
  const s = frozenState({ running: false });
  const next = workbenchReducer(s, { type: 'runOk', result: runResult });
  expect(next).toBe(s);
});

test('runFail sets error, running:false, clears pendingRequest, and marks any previous result stale', () => {
  const started = workbenchReducer(frozenState({ result: runResult, stale: false }), {
    type: 'runStart',
  });
  const edited = workbenchReducer(started, { type: 'setModel', model: 'other-model' });
  const error = { kind: 'timeout' as const, message: 'timed out' };
  const next = workbenchReducer(edited, { type: 'runFail', error });
  expect(next.error).toBe(error);
  expect(next.running).toBe(false);
  expect(next.pendingRequest).toBeUndefined();
  expect(next.result).toBe(runResult);
  expect(next.stale).toBe(true);
});

test('runFail is ignored (same state reference) when not running', () => {
  const s = frozenState({ running: false });
  const error = { kind: 'timeout' as const, message: 'timed out' };
  const next = workbenchReducer(s, { type: 'runFail', error });
  expect(next).toBe(s);
});

test('a runOk arriving after a loadSet is ignored because running is already false', () => {
  const started = workbenchReducer(frozenState(), { type: 'runStart' });
  const set: QuestionSet = { name: 'my-set', questions: { x: blankQuestion('noul') } };
  const loaded = workbenchReducer(started, { type: 'loadSet', set });
  expect(loaded.running).toBe(false);
  expect(loaded.pendingRequest).toBeUndefined();
  const next = workbenchReducer(loaded, { type: 'runOk', result: runResult });
  expect(next).toBe(loaded);
});

// --- requestToRun ------------------------------------------------------------

test('requestToRun returns the live request when no run is in flight', () => {
  const s = frozenState();
  expect(requestToRun(s)).toBe(s.request);
});

test('requestToRun returns the pendingRequest snapshot during a run, even after a later edit', () => {
  const started = workbenchReducer(frozenState(), { type: 'runStart' });
  const edited = workbenchReducer(started, { type: 'setModel', model: 'other-model' });
  expect(requestToRun(edited)).toBe(started.request);
  expect(requestToRun(edited)).not.toBe(edited.request);
});

// --- dismissError --------------------------------------------------------------

test('dismissError clears the error', () => {
  const s = frozenState({ error: { kind: 'validation', message: 'bad' } });
  const next = workbenchReducer(s, { type: 'dismissError' });
  expect(next.error).toBeUndefined();
});

test('dismissError with no error is a no-op (same state reference)', () => {
  const s = frozenState({ error: undefined });
  const next = workbenchReducer(s, { type: 'dismissError' });
  expect(next).toBe(s);
});

// --- errorTarget ------------------------------------------------------------

test('errorTarget(undefined) is {}', () => {
  expect(errorTarget(undefined)).toEqual({});
});

test('errorTarget for an unrecognized path is {}', () => {
  expect(errorTarget('something.else')).toEqual({});
});

test("errorTarget('state') and nested state paths target the state field", () => {
  expect(errorTarget('state')).toEqual({ field: 'state' });
  expect(errorTarget('state.foo')).toEqual({ field: 'state' });
  expect(errorTarget('state[0]')).toEqual({ field: 'state' });
});

test("errorTarget('model') targets the model field", () => {
  expect(errorTarget('model')).toEqual({ field: 'model' });
});

test("errorTarget('questions.q.instructions') targets the question's instructions", () => {
  expect(errorTarget('questions.q.instructions')).toEqual({
    questionId: 'q',
    field: 'instructions',
  });
});

test("errorTarget('questions.q.criteria[2]') targets the question's criteria", () => {
  expect(errorTarget('questions.q.criteria[2]')).toEqual({ questionId: 'q', field: 'criteria' });
});

test('errorTarget accepts question ids with dashes and underscores', () => {
  expect(errorTarget('questions.my-id_2.criteria[0]')).toEqual({
    questionId: 'my-id_2',
    field: 'criteria',
  });
});

test("errorTarget('questions.q') and ('questions.q.type') target only the question", () => {
  expect(errorTarget('questions.q')).toEqual({ questionId: 'q' });
  expect(errorTarget('questions.q.type')).toEqual({ questionId: 'q' });
});

// --- purity ------------------------------------------------------------------

test('workbenchReducer never mutates its (frozen) input state', () => {
  const s = frozenState({ error: { kind: 'validation', message: 'bad' }, result: runResult });
  const runningState = frozenState({ running: true, pendingRequest: s.request, result: runResult });
  expect(() => {
    workbenchReducer(s, { type: 'setModel', model: 'other' });
    workbenchReducer(s, { type: 'setState', state: 'x' });
    workbenchReducer(s, { type: 'replaceRequest', request: { ...baseRequest(), model: 'z' } });
    workbenchReducer(s, { type: 'addQuestion', questionType: 'noul' });
    workbenchReducer(s, { type: 'updateQuestion', id: 'a', question: blankQuestion('noul') });
    workbenchReducer(s, { type: 'deleteQuestion', id: 'a' });
    workbenchReducer(s, { type: 'duplicateQuestion', id: 'a' });
    workbenchReducer(s, { type: 'moveQuestion', id: 'b', delta: -1 });
    workbenchReducer(s, { type: 'renameQuestion', id: 'a', newId: 'z' });
    workbenchReducer(s, { type: 'select', id: 'c' });
    workbenchReducer(s, { type: 'saved', name: 'n' });
    workbenchReducer(s, { type: 'runStart' });
    workbenchReducer(s, { type: 'dismissError' });
    workbenchReducer(s, {
      type: 'loadSet',
      set: { name: 'n', questions: { x: blankQuestion('noul') } },
    });
    workbenchReducer(runningState, { type: 'runOk', result: runResult });
    workbenchReducer(runningState, { type: 'runFail', error: { kind: 'timeout', message: 'x' } });
  }).not.toThrow();
});
