// A labelled field for a question's `Text` value: a `PathInput` when the
// value is a plain string (or unset), or a read-only preview when it was
// authored as structured JSON — a form edit must never flatten that back
// down to a string.
import type { Text } from '@jev-ui/core/browser';
import { PathInput } from './PathInput.js';

export function TextField(props: {
  label: string;
  value: Text | undefined;
  onChange: (v: string) => void;
  paths: string[];
  invalid?: boolean;
  error?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const { label, value, onChange, paths, invalid, error, multiline, placeholder } = props;

  if (value !== undefined && typeof value !== 'string') {
    return (
      <div className="field-structured">
        <label className="f">
          {label}
          <pre className="structured">{JSON.stringify(value, null, 2)}</pre>
        </label>
        <p className="hint">structured — edit in JSON</p>
      </div>
    );
  }

  return (
    <div className="field">
      <PathInput
        value={value ?? ''}
        onChange={onChange}
        paths={paths}
        label={label}
        invalid={invalid}
        multiline={multiline}
        placeholder={placeholder}
      />
      {error !== undefined && <div role="alert">{error}</div>}
    </div>
  );
}
