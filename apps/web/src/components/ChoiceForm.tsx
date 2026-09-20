// The Choice question form: instructions plus an ordered list of
// key/description options (1-255). Option key order is meaningful, so a
// rename rebuilds the criteria object in place rather than deleting and
// re-adding the key at the end.
import { useEffect, useState, type KeyboardEvent } from 'react';
import { LIMITS, type ChoiceQuestion, type Text } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';
import { TextField } from './TextField.js';

let rowIdSeq = 0;
function nextRowId(): string {
  rowIdSeq += 1;
  return `opt-${rowIdSeq}`;
}

const INTEGER_KEY_RE = /^(0|[1-9]\d*)$/;

function nextOptionKey(criteria: Record<string, Text | null>): string {
  let n = 1;
  while (Object.hasOwn(criteria, `option_${n}`)) n += 1;
  return `option_${n}`;
}

function OptionRow(props: {
  index: number;
  optionKey: string;
  description: Text | null;
  paths: string[];
  disabledRemove: boolean;
  allKeys: string[];
  onRename: (newKey: string) => void;
  onDescriptionChange: (v: string) => void;
  onRemove: () => void;
}) {
  const {
    index,
    optionKey,
    description,
    paths,
    disabledRemove,
    allKeys,
    onRename,
    onDescriptionChange,
    onRemove,
  } = props;
  const [draft, setDraft] = useState(optionKey);
  const [keyError, setKeyError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setDraft(optionKey);
    setKeyError(undefined);
  }, [optionKey]);

  function commit(): void {
    const trimmed = draft.trim();
    if (trimmed === optionKey) {
      setDraft(optionKey);
      setKeyError(undefined);
      return;
    }
    if (trimmed === '') {
      setKeyError('Option key cannot be empty');
      return;
    }
    if (trimmed === '__proto__') {
      setKeyError('This key is not allowed');
      return;
    }
    if (allKeys.some((k) => k !== optionKey && k === trimmed)) {
      setKeyError('Another option already uses this key');
      return;
    }
    setKeyError(undefined);
    onRename(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(optionKey);
      setKeyError(undefined);
    }
  }

  const descriptionValue: Text = description === null ? '' : description;

  return (
    <div className="row">
      <span className="idx">{index}</span>
      <div className="field">
        <input
          className="inp mono"
          aria-label={`Option ${index} key`}
          value={draft}
          aria-invalid={keyError !== undefined ? 'true' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
        />
        {keyError !== undefined && (
          <div role="alert" className="field-error">
            {keyError}
          </div>
        )}
      </div>
      <TextField
        label={`Option ${index} description`}
        value={descriptionValue}
        onChange={onDescriptionChange}
        paths={paths}
      />
      <button
        type="button"
        className="x"
        aria-label={`Remove option ${index}`}
        disabled={disabledRemove}
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}

export function ChoiceForm(props: {
  id: string;
  question: ChoiceQuestion;
  paths: string[];
  error?: { field: string; message: string };
}) {
  const { id, question, paths, error } = props;
  const { dispatch } = useWorkbench();
  const keys = Object.keys(question.criteria);
  const [rowIds, setRowIds] = useState<string[]>(() => keys.map(() => nextRowId()));

  useEffect(() => {
    setRowIds((prev) => {
      const count = keys.length;
      if (prev.length === count) return prev;
      if (prev.length < count) {
        return [...prev, ...Array.from({ length: count - prev.length }, () => nextRowId())];
      }
      return prev.slice(0, count);
    });
  }, [keys.length]);

  function update(next: ChoiceQuestion): void {
    dispatch({ type: 'wb', action: { type: 'updateQuestion', id, question: next } });
  }

  function setInstructions(v: string): void {
    update({ ...question, instructions: v });
  }

  function setDescription(key: string, v: string): void {
    update({ ...question, criteria: { ...question.criteria, [key]: v === '' ? null : v } });
  }

  function renameKey(oldKey: string, newKey: string): void {
    const entries = Object.entries(question.criteria).map(
      ([k, v]) => [k === oldKey ? newKey : k, v] as const,
    );
    update({ ...question, criteria: Object.fromEntries(entries) });
  }

  function removeOption(key: string): void {
    if (keys.length <= 1) return;
    const removeIndex = keys.indexOf(key);
    const criteria = { ...question.criteria };
    delete criteria[key];
    setRowIds((prev) => prev.filter((_, i) => i !== removeIndex));
    update({ ...question, criteria });
  }

  function addOption(): void {
    if (keys.length >= LIMITS.choiceMax) return;
    const key = nextOptionKey(question.criteria);
    setRowIds((prev) => [...prev, nextRowId()]);
    update({ ...question, criteria: { ...question.criteria, [key]: null } });
  }

  const instructionsError = error?.field === 'instructions' ? error.message : undefined;
  const criteriaError = error?.field === 'criteria' ? error.message : undefined;
  const hasIntegerKey = keys.some((k) => INTEGER_KEY_RE.test(k));

  return (
    <div className="choice-form">
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
        <legend>Options</legend>
        <p className="hint">1–255 · order is kept</p>
        {criteriaError !== undefined && <div role="alert">{criteriaError}</div>}
        {keys.map((key, index) => (
          <OptionRow
            key={rowIds[index] ?? `fallback-${index}`}
            index={index}
            optionKey={key}
            description={question.criteria[key] ?? null}
            paths={paths}
            disabledRemove={keys.length <= 1}
            allKeys={keys}
            onRename={(newKey) => renameKey(key, newKey)}
            onDescriptionChange={(v) => setDescription(key, v)}
            onRemove={() => removeOption(key)}
          />
        ))}
        {hasIntegerKey && (
          <p className="hint">Numeric keys are always listed first, in numeric order.</p>
        )}
        <button
          type="button"
          className="add"
          disabled={keys.length >= LIMITS.choiceMax}
          onClick={addOption}
        >
          Add option
        </button>
      </fieldset>
    </div>
  );
}
