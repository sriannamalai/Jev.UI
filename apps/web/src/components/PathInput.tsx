// A labelled text input (or textarea, when `multiline`) with backtick
// `` `path` `` autocomplete against the state's enumerated paths. Combobox
// ARIA: role="combobox" on the field, role="listbox"/"option" on the
// suggestions.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { activeBacktick, completePaths } from '@jev-ui/core/browser';

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

export function PathInput(props: {
  value: string;
  onChange: (v: string) => void;
  paths: string[];
  label: string;
  invalid?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  const { value, onChange, paths, label, invalid, multiline, placeholder } = props;
  const fieldRef = useRef<FieldElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(value.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | undefined>(undefined);
  const listId = useId();
  const fieldId = useId();

  const bt = activeBacktick(value, caret);
  const suggestions = bt ? completePaths(paths, bt.query, 8) : [];
  const open = bt !== undefined && suggestions.length > 0 && dismissedFor !== value;
  const clampedActive = Math.min(activeIndex, Math.max(0, suggestions.length - 1));

  useEffect(() => {
    setActiveIndex(0);
  }, [bt?.start, bt?.query]);

  useEffect(() => {
    if (pendingCaret.current !== null && fieldRef.current) {
      fieldRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  function syncCaret(el: FieldElement): void {
    setCaret(el.selectionStart ?? el.value.length);
  }

  function insert(path: string): void {
    if (!bt) return;
    const after = value.slice(caret);
    const needsClosingTick = after.charAt(0) !== '`';
    const newValue = `${value.slice(0, bt.start)}${path}${needsClosingTick ? '`' : ''}${after}`;
    const newCaret = bt.start + path.length + (needsClosingTick ? 1 : 0);
    pendingCaret.current = newCaret;
    setCaret(newCaret);
    onChange(newValue);
  }

  function handleKeyDown(event: KeyboardEvent<FieldElement>): void {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setDismissedFor(value);
      return;
    }
    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      const chosen = suggestions[clampedActive];
      if (chosen !== undefined) {
        event.preventDefault();
        insert(chosen);
      }
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;

  const sharedProps = {
    id: fieldId,
    className: 'inp',
    value,
    placeholder,
    role: 'combobox' as const,
    'aria-expanded': open,
    'aria-controls': listId,
    'aria-autocomplete': 'list' as const,
    'aria-activedescendant': open ? optionId(clampedActive) : undefined,
    'aria-invalid': invalid ? ('true' as const) : undefined,
    onKeyDown: handleKeyDown,
    onSelect: (event: React.SyntheticEvent<FieldElement>) => syncCaret(event.currentTarget),
    onChange: (event: React.ChangeEvent<FieldElement>) => {
      onChange(event.target.value);
      syncCaret(event.target);
    },
  };

  return (
    <div className="path-input">
      <label className="f" htmlFor={fieldId}>
        {label}
        {multiline ? (
          <textarea ref={fieldRef as React.RefObject<HTMLTextAreaElement>} {...sharedProps} />
        ) : (
          <input ref={fieldRef as React.RefObject<HTMLInputElement>} type="text" {...sharedProps} />
        )}
      </label>
      {open && (
        <ul className="listbox" role="listbox" id={listId}>
          {suggestions.map((path, i) => (
            <li
              key={path}
              id={optionId(i)}
              role="option"
              aria-selected={i === clampedActive}
              className={i === clampedActive ? 'option active' : 'option'}
              onClick={() => insert(path)}
            >
              <span className="path">{path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
