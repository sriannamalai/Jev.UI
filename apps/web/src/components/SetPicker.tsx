// The top bar's set picker (spec §8): a labelled select listing every saved
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
    if (name === '' || name === current) return;
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
