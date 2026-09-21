// The top bar's model picker: a combobox built from an
// `<input list>` + `<datalist>` so a pinned model id can be typed freely
// even though it isn't one of `/api/models`'s names. Commits on blur/Enter,
// never on every keystroke, and an empty commit reverts rather than
// dispatching an empty model.
import { useEffect, useState } from 'react';
import type { ModelInfo } from '@jev-ui/core/browser';

export function ModelPicker(props: {
  models: ModelInfo[];
  value: string;
  resolved: string | undefined;
  onChange: (model: string) => void;
}) {
  const { models, value, resolved, onChange } = props;
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  function commit() {
    const trimmed = text.trim();
    if (trimmed === '') {
      setText(value);
      return;
    }
    if (trimmed !== value) onChange(trimmed);
    setText(trimmed);
  }

  return (
    <div className="sel">
      <label htmlFor="model-picker">
        <small>Model</small>
      </label>
      <input
        id="model-picker"
        className="mono"
        list="model-options"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <datalist id="model-options">
        {models.map((m) => (
          <option key={m.name} value={m.name} />
        ))}
      </datalist>
      {resolved !== undefined && resolved !== value && <small className="mono">→ {resolved}</small>}
    </div>
  );
}
