// The top bar's set picker: a labelled select listing every saved
// set, with invalid sets disabled and their parse error surfaced as a
// tooltip. Loading over unsaved changes asks first, inline, rather than
// with `window.confirm`.
import { useState } from 'react';
import type { SetSummary } from '@jev-ui/core/browser';

export function SetPicker(props: {
  sets: SetSummary[];
  current: string | undefined;
  dirty: boolean;
  onLoad: (name: string) => void;
}) {
  const { sets, current, dirty, onLoad } = props;
  const [pendingName, setPendingName] = useState<string | undefined>(undefined);

  function requestLoad(name: string) {
    if (name === '') return;
    if (name === current) {
      // Re-selecting the current set is normally a no-op, but when dirty it
      // is the only way to reload it and discard the in-progress edits — so
      // route it through the same confirm as switching to a different set.
      if (dirty) setPendingName(name);
      return;
    }
    if (dirty) {
      setPendingName(name);
      return;
    }
    onLoad(name);
  }

  function confirmLoad() {
    if (pendingName === undefined) return;
    const name = pendingName;
    setPendingName(undefined);
    onLoad(name);
  }

  return (
    <div className="sel">
      <label htmlFor="set-picker">
        <small>Set</small>
      </label>
      <select
        id="set-picker"
        className="mono"
        value={current ?? ''}
        onChange={(e) => requestLoad(e.target.value)}
      >
        {current === undefined && <option value="">— unsaved —</option>}
        {sets.map((s) => (
          <option key={s.name} value={s.name} disabled={!s.valid} title={s.error}>
            {s.name}
          </option>
        ))}
      </select>
      {dirty && current !== undefined && <b aria-hidden="true">●</b>}
      {pendingName !== undefined && (
        <span className="confirm-row" role="group" aria-label="Confirm discard">
          Discard unsaved changes?
          <button type="button" onClick={confirmLoad}>
            Load
          </button>
          <button type="button" onClick={() => setPendingName(undefined)}>
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}
