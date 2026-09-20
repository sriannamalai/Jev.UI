// The Score question form: instructions plus an ordered list of level
// descriptions (2–10). Row ids are generated once per level and re-synced
// (not fully regenerated) when the level count changes from outside, so
// removing a middle row doesn't remount — and therefore doesn't scramble —
// the surviving inputs.
import { useEffect, useState } from 'react';
import { LIMITS, type ScoreQuestion } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';
import { TextField } from './TextField.js';

let rowIdSeq = 0;
function nextRowId(): string {
  rowIdSeq += 1;
  return `lvl-${rowIdSeq}`;
}

export function ScoreForm(props: {
  id: string;
  question: ScoreQuestion;
  paths: string[];
  error?: { field: string; message: string };
}) {
  const { id, question, paths, error } = props;
  const { dispatch } = useWorkbench();
  const [rowIds, setRowIds] = useState<string[]>(() => question.criteria.map(() => nextRowId()));

  useEffect(() => {
    setRowIds((prev) => {
      const count = question.criteria.length;
      if (prev.length === count) return prev;
      if (prev.length < count) {
        return [...prev, ...Array.from({ length: count - prev.length }, () => nextRowId())];
      }
      return prev.slice(0, count);
    });
  }, [question.criteria.length]);

  function update(next: ScoreQuestion): void {
    dispatch({ type: 'wb', action: { type: 'updateQuestion', id, question: next } });
  }

  function setInstructions(v: string): void {
    update({ ...question, instructions: v });
  }

  function setLevel(index: number, v: string): void {
    const criteria = question.criteria.slice();
    criteria[index] = v;
    update({ ...question, criteria });
  }

  function addLevel(): void {
    if (question.criteria.length >= LIMITS.scoreMax) return;
    setRowIds((prev) => [...prev, nextRowId()]);
    update({ ...question, criteria: [...question.criteria, ''] });
  }

  function removeLevel(index: number): void {
    if (question.criteria.length <= LIMITS.scoreMin) return;
    setRowIds((prev) => prev.filter((_, i) => i !== index));
    update({ ...question, criteria: question.criteria.filter((_, i) => i !== index) });
  }

  const instructionsError = error?.field === 'instructions' ? error.message : undefined;
  const criteriaError = error?.field === 'criteria' ? error.message : undefined;

  return (
    <div className="score-form">
      <TextField
        label="Instructions"
        value={question.instructions}
        onChange={setInstructions}
        paths={paths}
        multiline
        invalid={instructionsError !== undefined}
        error={instructionsError}
      />
      <fieldset aria-invalid={criteriaError !== undefined ? 'true' : undefined}>
        <legend>Levels</legend>
        <p className="hint">ordered low → high · 2–10</p>
        {criteriaError !== undefined && <div role="alert">{criteriaError}</div>}
        {question.criteria.map((level, index) => (
          <div className="row lvl" key={rowIds[index] ?? `fallback-${index}`}>
            <span className="idx">{index}</span>
            <TextField
              label={`Level ${index}`}
              value={level}
              onChange={(v) => setLevel(index, v)}
              paths={paths}
            />
            <button
              type="button"
              className="x"
              aria-label={`Remove level ${index}`}
              disabled={question.criteria.length <= LIMITS.scoreMin}
              onClick={() => removeLevel(index)}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="add"
          disabled={question.criteria.length >= LIMITS.scoreMax}
          onClick={addLevel}
        >
          Add level
        </button>
      </fieldset>
    </div>
  );
}
