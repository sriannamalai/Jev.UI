import {
  addQuestion,
  deleteQuestion,
  duplicateQuestion,
  moveQuestion,
  newRequest,
  QUESTION_ID_RE,
  questionIds,
  renameQuestion,
  updateQuestion,
} from './doc.js';
import type { JevErrorKind } from './errors.js';
import {
  RequestSchema,
  type Question,
  type QuestionSet,
  type QuestionType,
  type Request,
  type RunResult,
  type Text,
} from './schema.js';
import { requestFromSet } from './set.js';

export interface WorkbenchState {
  request: Request;
  selectedId: string | undefined;
  setName: string | undefined;
  dirty: boolean;
  result: RunResult | undefined;
  stale: boolean;
  running: boolean;
  error: { kind: JevErrorKind; message: string; path?: string } | undefined;
}

export type WorkbenchAction =
  | { type: 'setState'; state: Text }
  | { type: 'setModel'; model: string }
  | { type: 'replaceRequest'; request: Request }
  | { type: 'addQuestion'; questionType: QuestionType }
  | { type: 'updateQuestion'; id: string; question: Question }
  | { type: 'deleteQuestion'; id: string }
  | { type: 'duplicateQuestion'; id: string }
  | { type: 'moveQuestion'; id: string; delta: -1 | 1 }
  | { type: 'renameQuestion'; id: string; newId: string }
  | { type: 'select'; id: string | undefined }
  | { type: 'loadSet'; set: QuestionSet }
  | { type: 'saved'; name: string }
  | { type: 'runStart' }
  | { type: 'runOk'; result: RunResult }
  | { type: 'runFail'; error: WorkbenchState['error'] }
  | { type: 'dismissError' };

export function initialWorkbench(request?: Request): WorkbenchState {
  const req = request ?? newRequest();
  return {
    request: req,
    selectedId: questionIds(req)[0],
    setName: undefined,
    dirty: false,
    result: undefined,
    stale: false,
    running: false,
    error: undefined,
  };
}

export function canRun(s: WorkbenchState): boolean {
  return !s.running && RequestSchema.safeParse(s.request).success;
}

const ID_PATTERN = QUESTION_ID_RE.source.slice(1, -1);
const QUESTIONS_PATH_RE = new RegExp(
  `^questions\\.(${ID_PATTERN})(?:\\.(instructions|criteria|type)(?:[.[].*)?)?$`,
);

export function errorTarget(path: string | undefined): {
  questionId?: string;
  field?: 'instructions' | 'criteria' | 'state' | 'model';
} {
  if (path === undefined) return {};
  if (path === 'state' || path.startsWith('state.') || path.startsWith('state[')) {
    return { field: 'state' };
  }
  if (path === 'model') return { field: 'model' };

  const match = QUESTIONS_PATH_RE.exec(path);
  if (!match) return {};

  const questionId = match[1];
  const field = match[2];
  if (field === 'instructions' || field === 'criteria') {
    return { questionId, field };
  }
  return { questionId };
}

function textEqual(a: Text, b: Text): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function applyRequestChange(
  state: WorkbenchState,
  request: Request,
  selectedId: string | undefined = state.selectedId,
): WorkbenchState {
  return {
    ...state,
    request,
    selectedId,
    dirty: true,
    stale: state.result !== undefined ? true : state.stale,
    error: undefined,
  };
}

export function workbenchReducer(s: WorkbenchState, a: WorkbenchAction): WorkbenchState {
  switch (a.type) {
    case 'setState': {
      if (textEqual(s.request.state, a.state)) return s;
      return applyRequestChange(s, { ...s.request, state: a.state });
    }

    case 'setModel': {
      if (s.request.model === a.model) return s;
      return applyRequestChange(s, { ...s.request, model: a.model });
    }

    case 'replaceRequest': {
      if (JSON.stringify(a.request) === JSON.stringify(s.request)) return s;
      const ids = questionIds(a.request);
      const selectedId =
        s.selectedId !== undefined && ids.includes(s.selectedId) ? s.selectedId : ids[0];
      return applyRequestChange(s, a.request, selectedId);
    }

    case 'addQuestion': {
      const { request, id } = addQuestion(s.request, a.questionType);
      return applyRequestChange(s, request, id);
    }

    case 'updateQuestion': {
      if (!(a.id in s.request.questions)) return s;
      const request = updateQuestion(s.request, a.id, a.question);
      return applyRequestChange(s, request);
    }

    case 'deleteQuestion': {
      const idsBefore = questionIds(s.request);
      const idx = idsBefore.indexOf(a.id);
      const request = deleteQuestion(s.request, a.id);
      if (request === s.request) return s;

      let selectedId = s.selectedId;
      if (s.selectedId === a.id) {
        const idsAfter = questionIds(request);
        const nextIdx = idx < idsAfter.length ? idx : idsAfter.length - 1;
        selectedId = idsAfter[nextIdx];
      }
      return applyRequestChange(s, request, selectedId);
    }

    case 'duplicateQuestion': {
      const result = duplicateQuestion(s.request, a.id);
      if (result.request === s.request) return s;
      return applyRequestChange(s, result.request, result.id);
    }

    case 'moveQuestion': {
      const request = moveQuestion(s.request, a.id, a.delta);
      if (request === s.request) return s;
      return applyRequestChange(s, request);
    }

    case 'renameQuestion': {
      const result = renameQuestion(s.request, a.id, a.newId);
      if (!result.ok) return s;
      if (result.request === s.request) return s;
      const selectedId = s.selectedId === a.id ? a.newId : s.selectedId;
      return applyRequestChange(s, result.request, selectedId);
    }

    case 'select': {
      if (s.selectedId === a.id) return s;
      return { ...s, selectedId: a.id };
    }

    case 'loadSet': {
      const request = requestFromSet(a.set);
      return {
        ...s,
        request,
        selectedId: questionIds(request)[0],
        setName: a.set.name,
        dirty: false,
        result: undefined,
        stale: false,
        running: false,
        error: undefined,
      };
    }

    case 'saved': {
      return { ...s, setName: a.name, dirty: false };
    }

    case 'runStart': {
      if (!canRun(s)) return s;
      return { ...s, running: true, error: undefined };
    }

    case 'runOk': {
      if (!s.running) return s;
      return { ...s, result: a.result, stale: false, running: false };
    }

    case 'runFail': {
      if (!s.running) return s;
      return {
        ...s,
        error: a.error,
        running: false,
        stale: s.result !== undefined ? true : s.stale,
      };
    }

    case 'dismissError': {
      if (s.error === undefined) return s;
      return { ...s, error: undefined };
    }
  }
}
