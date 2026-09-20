import { DEFAULT_MODEL, type Question, type QuestionType, type Request } from './schema.js';

export const QUESTION_ID_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function newRequest(): Request {
  return {
    state: '',
    model: DEFAULT_MODEL,
    questions: { question_1: blankQuestion('noul') },
  };
}

export function blankQuestion(type: QuestionType): Question {
  switch (type) {
    case 'noul':
      return { type: 'noul', instructions: '' };
    case 'choice':
      return { type: 'choice', instructions: '', criteria: { option_1: null, option_2: null } };
    case 'score':
      return { type: 'score', instructions: '', criteria: ['', ''] };
  }
}

export function uniqueId(request: Request, base: string): string {
  if (!(base in request.questions)) return base;

  const match = /^(.*)_(\d+)$/.exec(base);
  const prefix = match ? (match[1] ?? base) : base;
  let n = match ? Number(match[2] ?? '1') + 1 : 2;

  let candidate = `${prefix}_${n}`;
  while (candidate in request.questions) {
    n += 1;
    candidate = `${prefix}_${n}`;
  }
  return candidate;
}

export function addQuestion(
  request: Request,
  type: QuestionType,
): { request: Request; id: string } {
  const id = uniqueId(request, `${type}_1`);
  const questions = { ...request.questions, [id]: blankQuestion(type) };
  return { request: { ...request, questions }, id };
}

export function updateQuestion(request: Request, id: string, q: Question): Request {
  return { ...request, questions: { ...request.questions, [id]: q } };
}

export function deleteQuestion(request: Request, id: string): Request {
  const ids = Object.keys(request.questions);
  if (ids.length <= 1 || !(id in request.questions)) return request;

  const entries = Object.entries(request.questions).filter(([k]) => k !== id);
  return { ...request, questions: Object.fromEntries(entries) };
}

export function duplicateQuestion(request: Request, id: string): { request: Request; id: string } {
  const source = request.questions[id];
  if (!source) return { request, id };

  const newId = uniqueId(request, `${id}_copy`);
  const entries = Object.entries(request.questions);
  const idx = entries.findIndex(([k]) => k === id);
  const newEntries = [
    ...entries.slice(0, idx + 1),
    [newId, source] as [string, Question],
    ...entries.slice(idx + 1),
  ];
  return { request: { ...request, questions: Object.fromEntries(newEntries) }, id: newId };
}

export function moveQuestion(request: Request, id: string, delta: -1 | 1): Request {
  const entries = Object.entries(request.questions);
  const idx = entries.findIndex(([k]) => k === id);
  if (idx === -1) return request;

  const target = idx + delta;
  if (target < 0 || target >= entries.length) return request;

  const a = entries[idx];
  const b = entries[target];
  if (!a || !b) return request;

  const newEntries = entries.slice();
  newEntries[idx] = b;
  newEntries[target] = a;
  return { ...request, questions: Object.fromEntries(newEntries) };
}

export function renameQuestion(
  request: Request,
  id: string,
  newId: string,
): { ok: true; request: Request } | { ok: false; reason: 'invalid' | 'duplicate' } {
  if (!QUESTION_ID_RE.test(newId)) return { ok: false, reason: 'invalid' };
  if (newId !== id && newId in request.questions) return { ok: false, reason: 'duplicate' };
  if (newId === id) return { ok: true, request };

  const entries = Object.entries(request.questions).map(([k, v]): [string, Question] =>
    k === id ? [newId, v] : [k, v],
  );
  return { ok: true, request: { ...request, questions: Object.fromEntries(entries) } };
}

export function questionIds(request: Request): string[] {
  return Object.keys(request.questions);
}
