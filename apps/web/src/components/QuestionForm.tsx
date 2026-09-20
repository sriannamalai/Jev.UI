// Picks the per-type form for a question and, when the store's last API
// error targets this question, threads its field + message down as the
// `error` prop.
import { useMemo } from 'react';
import { enumeratePaths, errorTarget } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';
import { ChoiceForm } from './ChoiceForm.js';
import { NoulForm } from './NoulForm.js';
import { ScoreForm } from './ScoreForm.js';

export function QuestionForm(props: { id: string }) {
  const { id } = props;
  const { state } = useWorkbench();
  const request = state.wb.request;
  const question = request.questions[id];
  const paths = useMemo(() => enumeratePaths(request.state), [request.state]);

  if (!question) return null;

  const wbError = state.wb.error;
  const target = errorTarget(wbError?.path);
  const error =
    wbError?.kind === 'validation' && target.questionId === id
      ? { field: target.field ?? 'instructions', message: wbError.message }
      : undefined;

  switch (question.type) {
    case 'noul':
      return <NoulForm id={id} question={question} paths={paths} error={error} />;
    case 'score':
      return <ScoreForm id={id} question={question} paths={paths} error={error} />;
    case 'choice':
      return <ChoiceForm id={id} question={question} paths={paths} error={error} />;
  }
}
