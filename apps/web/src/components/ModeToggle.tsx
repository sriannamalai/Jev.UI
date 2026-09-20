// The Form/Split/JSON three-way toggle (spec §8.1). `Mode` lives in the web
// store, not core, so it is imported as a type only.
import type { Mode } from '../store.js';

const MODES: readonly { mode: Mode; label: string }[] = [
  { mode: 'form', label: 'Form' },
  { mode: 'split', label: 'Split' },
  { mode: 'json', label: 'JSON' },
];

export function ModeToggle(props: { mode: Mode; onChange: (mode: Mode) => void }) {
  const { mode, onChange } = props;
  return (
    <div className="seg" role="group" aria-label="Editor mode">
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          aria-pressed={mode === m.mode}
          onClick={() => onChange(m.mode)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
