// One question's chrome: type tag, inline-editable id, duplicate/delete/
// move controls, and an expand/collapse body. `QuestionForm` renders the
// per-type fields inside that body.
import { useEffect, useState, type KeyboardEvent } from 'react';
import { isValidQuestionId, questionIds, type Question } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';
import { QuestionForm } from './QuestionForm.js';

function summarize(question: Question): string {
  switch (question.type) {
    case 'choice':
      return `${Object.keys(question.criteria).length} options`;
    case 'score':
      return `${question.criteria.length} levels`;
    case 'noul':
      return typeof question.instructions === 'string'
        ? question.instructions.slice(0, 60)
        : 'structured instructions';
  }
}

export function QuestionCard(props: { id: string }) {
  const { id } = props;
  const { state, dispatch } = useWorkbench();
  const request = state.wb.request;
  const question = request.questions[id];

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(id);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!editing) setDraft(id);
  }, [id, editing]);

  if (!question) return null;

  const ids = questionIds(request);
  const idx = ids.indexOf(id);
  const expanded = state.wb.selectedId === id;
  const bodyId = `q-body-${id}`;

  function select(): void {
    dispatch({ type: 'wb', action: { type: 'select', id } });
  }

  function startEdit(): void {
    setDraft(id);
    setError(undefined);
    setEditing(true);
  }

  function commit(): void {
    if (draft === id) {
      setEditing(false);
      setError(undefined);
      return;
    }
    if (!isValidQuestionId(draft)) {
      setError('Use letters, digits, _ or - (must start with a letter or _)');
      return;
    }
    if (Object.hasOwn(request.questions, draft)) {
      setError('A question with this id already exists');
      return;
    }
    dispatch({ type: 'wb', action: { type: 'renameQuestion', id, newId: draft } });
    setEditing(false);
    setError(undefined);
  }

  function cancel(): void {
    setDraft(id);
    setEditing(false);
    setError(undefined);
  }

  function handleIdKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }

  return (
    <div className={expanded ? 'q active' : 'q'} role="group" aria-label={`Question ${id}`}>
      <div className="q-head">
        <button
          type="button"
          className="q-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={select}
        >
          <span className="grip" aria-hidden="true">
            ⋮⋮
          </span>
          <span className="tag">{question.type}</span>
          <span className="qid mono">{id}</span>
          {!expanded && <span className="summary">{summarize(question)}</span>}
        </button>
        {editing ? (
          <input
            className="qid-input mono"
            value={draft}
            autoFocus
            aria-label={`Rename question ${id}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleIdKeyDown}
            onBlur={commit}
          />
        ) : (
          <button
            type="button"
            className="qid-edit"
            aria-label={`Rename question ${id}`}
            onClick={startEdit}
          >
            ✎
          </button>
        )}
        <span className="r">
          <button
            type="button"
            aria-label={`Duplicate question ${id}`}
            onClick={() => dispatch({ type: 'wb', action: { type: 'duplicateQuestion', id } })}
          >
            ⧉
          </button>
          <button
            type="button"
            aria-label={`Delete question ${id}`}
            disabled={ids.length <= 1}
            onClick={() => dispatch({ type: 'wb', action: { type: 'deleteQuestion', id } })}
          >
            ✕
          </button>
          <button
            type="button"
            aria-label={`Move question ${id} up`}
            disabled={idx <= 0}
            onClick={() =>
              dispatch({ type: 'wb', action: { type: 'moveQuestion', id, delta: -1 } })
            }
          >
            ▲
          </button>
          <button
            type="button"
            aria-label={`Move question ${id} down`}
            disabled={idx === -1 || idx >= ids.length - 1}
            onClick={() => dispatch({ type: 'wb', action: { type: 'moveQuestion', id, delta: 1 } })}
          >
            ▼
          </button>
        </span>
      </div>
      {error && <div role="alert">{error}</div>}
      {expanded && (
        <div className="q-body" id={bodyId}>
          <QuestionForm id={id} />
        </div>
      )}
    </div>
  );
}
