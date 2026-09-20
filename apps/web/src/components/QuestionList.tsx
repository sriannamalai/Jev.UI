// Heading + one QuestionCard per question, in request order, plus the
// "add a question" row.
import { useEffect } from 'react';
import { errorTarget, questionIds, type QuestionType } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';
import { QuestionCard } from './QuestionCard.js';

export function QuestionList() {
  const { state, dispatch } = useWorkbench();
  const ids = questionIds(state.wb.request);
  const error = state.wb.error;

  // Jump to the question a validation error targets, once per distinct
  // error object — not on every render — so a user who then selects a
  // different card isn't fought back to this one.
  useEffect(() => {
    if (error === undefined || error.kind !== 'validation') return;
    const target = errorTarget(error.path);
    if (target.questionId === undefined) return;
    if (!Object.hasOwn(state.wb.request.questions, target.questionId)) return;
    dispatch({ type: 'wb', action: { type: 'select', id: target.questionId } });
    // Intentionally keyed on `error` alone: see comment above.
  }, [error]);

  function add(questionType: QuestionType): void {
    dispatch({ type: 'wb', action: { type: 'addQuestion', questionType } });
  }

  return (
    <div className="sec">
      <h2 className="sec-title">Questions</h2>
      {ids.map((id) => (
        <QuestionCard key={id} id={id} />
      ))}
      <div className="addq">
        <button type="button" onClick={() => add('noul')}>
          + Noul
        </button>
        <button type="button" onClick={() => add('choice')}>
          + Choice
        </button>
        <button type="button" onClick={() => add('score')}>
          + Score
        </button>
      </div>
    </div>
  );
}
