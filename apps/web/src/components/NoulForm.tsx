// The Noul (yes/no) question form: instructions plus optional "what yes
// means" / "what no means" criteria. Clearing a criteria field removes it
// from the dispatched question rather than sending '' or null.
import type { NoulQuestion, Text } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';
import { TextField } from './TextField.js';

export function NoulForm(props: {
  id: string;
  question: NoulQuestion;
  paths: string[];
  error?: { field: string; message: string };
}) {
  const { id, question, paths, error } = props;
  const { dispatch } = useWorkbench();

  function update(next: NoulQuestion): void {
    dispatch({ type: 'wb', action: { type: 'updateQuestion', id, question: next } });
  }

  function setInstructions(v: string): void {
    update({ ...question, instructions: v });
  }

  function setCriteria(key: 'true' | 'false', v: string): void {
    const nextCriteria: { true?: Text; false?: Text } = { ...question.criteria };
    if (v === '') {
      delete nextCriteria[key];
    } else {
      nextCriteria[key] = v;
    }
    update(
      Object.keys(nextCriteria).length > 0
        ? { type: 'noul', instructions: question.instructions, criteria: nextCriteria }
        : { type: 'noul', instructions: question.instructions },
    );
  }

  const instructionsError = error?.field === 'instructions' ? error.message : undefined;
  const criteriaError = error?.field === 'criteria' ? error.message : undefined;

  return (
    <div className="noul-form">
      <TextField
        label="Instructions"
        value={question.instructions}
        onChange={setInstructions}
        paths={paths}
        multiline
        invalid={instructionsError !== undefined}
        error={instructionsError}
      />
      <TextField
        label="Yes means"
        value={question.criteria?.true}
        onChange={(v) => setCriteria('true', v)}
        paths={paths}
        invalid={criteriaError !== undefined}
        error={criteriaError}
      />
      <TextField
        label="No means"
        value={question.criteria?.false}
        onChange={(v) => setCriteria('false', v)}
        paths={paths}
        invalid={criteriaError !== undefined}
        error={criteriaError}
      />
    </div>
  );
}
