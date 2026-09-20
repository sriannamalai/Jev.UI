import { DEFAULT_MODEL, type QuestionSet, type Request, type Text } from './schema.js';

export const SET_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function requestFromSet(
  set: QuestionSet,
  overrides?: { state?: Text; model?: string },
): Request {
  return {
    state: overrides?.state ?? set.state ?? '',
    model: overrides?.model ?? set.model ?? DEFAULT_MODEL,
    questions: set.questions,
  };
}

export function setFromRequest(name: string, request: Request): QuestionSet {
  return {
    name,
    questions: request.questions,
    state: request.state,
    model: request.model,
  };
}
