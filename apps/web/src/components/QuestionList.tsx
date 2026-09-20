// Heading + one QuestionCard per question, in request order, plus the
// "add a question" row.
import { questionIds, type QuestionType } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';
import { QuestionCard } from './QuestionCard.js';

export function QuestionList() {
  const { state, dispatch } = useWorkbench();
  const ids = questionIds(state.wb.request);

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
