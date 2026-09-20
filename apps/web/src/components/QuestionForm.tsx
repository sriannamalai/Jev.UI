// Picks the per-type form for a question. `choice` is a later slice's job —
// this leaves the same placeholder slot for it to mount into.
import { useMemo } from 'react';
import { enumeratePaths } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';
import { NoulForm } from './NoulForm.js';
import { ScoreForm } from './ScoreForm.js';

export function QuestionForm(props: { id: string }) {
  const { id } = props;
  const { state } = useWorkbench();
  const request = state.wb.request;
  const question = request.questions[id];
  const paths = useMemo(() => enumeratePaths(request.state), [request.state]);

  if (!question) return null;

  switch (question.type) {
    case 'noul':
      return <NoulForm id={id} question={question} paths={paths} />;
    case 'score':
      return <ScoreForm id={id} question={question} paths={paths} />;
    case 'choice':
      return <div data-slot="choice-form" />;
  }
}
