// Save (spec §8): saves directly when the document already has a set name,
// otherwise opens an inline name field validated live against
// `SET_NAME_RE`. A rejection is shown inline — it must never dispatch
// `runFail`, since a failed save is not a failed run.
import { useState } from 'react';
import { SET_NAME_RE } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';

export const NAME_ERROR =
  'Use lowercase letters, digits, - or _ (must start with a letter or digit)';

export function SaveButton(props: { onSaved?: () => void }) {
  const { onSaved } = props;
  const { state, save } = useWorkbench();
  const setName = state.wb.setName;

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName_] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function doSave(target: string) {
    setSaving(true);
    setError(undefined);
    try {
      await save(target);
      setIsEditing(false);
      setName_('');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (setName !== undefined) {
    return (
      <button
        type="button"
        className="ghost"
        disabled={saving}
        onClick={() => void doSave(setName)}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    );
  }

  if (!isEditing) {
    return (
      <button type="button" className="ghost" onClick={() => setIsEditing(true)}>
        Save
      </button>
    );
  }

  const nameValid = SET_NAME_RE.test(name);

  return (
    <span className="sel">
      <label htmlFor="save-set-name">Set name</label>
      <input
        id="save-set-name"
        className="mono"
        autoFocus
        disabled={saving}
        value={name}
        onChange={(e) => setName_(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setIsEditing(false);
            setName_('');
            setError(undefined);
          } else if (e.key === 'Enter' && nameValid) {
            void doSave(name);
          }
        }}
      />
      <button type="button" disabled={saving || !nameValid} onClick={() => void doSave(name)}>
        Save
      </button>
      {name !== '' && !nameValid && <span role="alert">{NAME_ERROR}</span>}
      {error !== undefined && <span role="alert">{error}</span>}
    </span>
  );
}
