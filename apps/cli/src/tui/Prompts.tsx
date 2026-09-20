// Small hand-rolled text editors for the TUI's edit keys (spec §8.2).
// `ink-text-input` isn't a dependency here — these build directly on Ink's
// `useInput` so the editing model (cursor, scrolling, validation) stays in
// one place and is exercised the same way `handleKey` is.
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { truncate } from './bars.js';

const DEFAULT_WIDTH = 60;

function clampCursor(value: string, cursor: number): number {
  return Math.max(0, Math.min(value.length, cursor));
}

/** The slice of `value` (and the cursor's position within it) that fits in
 * `width` columns while keeping the cursor visible, scrolling horizontally
 * when the text is longer than the available width. */
function visibleWindow(
  value: string,
  cursor: number,
  width: number,
): { text: string; cursorIndex: number } {
  const room = Math.max(1, width);
  if (value.length < room) {
    return { text: value, cursorIndex: cursor };
  }
  let start = Math.max(0, cursor - room + 1);
  start = Math.min(start, Math.max(0, value.length - room));
  return { text: value.slice(start, start + room), cursorIndex: cursor - start };
}

export function TextPrompt(props: {
  label: string;
  initial?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  validate?: (value: string) => string | undefined;
  width?: number;
  color?: boolean;
  /** Ctrl+C is never swallowed by a prompt: the app wires this to "cancel
   * this prompt and start the quit flow", so a terminal program still
   * responds to the interrupt key from anywhere. */
  onCtrlC?: () => void;
}) {
  const {
    label,
    initial = '',
    onSubmit,
    onCancel,
    validate,
    width = DEFAULT_WIDTH,
    color = true,
    onCtrlC,
  } = props;
  const [value, setValue] = useState(initial);
  const [cursor, setCursor] = useState(initial.length);
  const [error, setError] = useState<string | undefined>(undefined);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCtrlC?.();
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const message = validate?.(value);
      if (message) {
        setError(message);
        return;
      }
      onSubmit(value);
      return;
    }

    setError(undefined);

    if (key.leftArrow) {
      setCursor((c) => clampCursor(value, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => clampCursor(value, c + 1));
      return;
    }
    if (key.home || (key.ctrl && input === 'a')) {
      setCursor(0);
      return;
    }
    if (key.end || (key.ctrl && input === 'e')) {
      setCursor(value.length);
      return;
    }
    if (key.backspace) {
      if (cursor === 0) return;
      setValue(value.slice(0, cursor - 1) + value.slice(cursor));
      setCursor(cursor - 1);
      return;
    }
    if (key.delete) {
      setValue(value.slice(0, cursor) + value.slice(cursor + 1));
      return;
    }
    if (key.ctrl || key.meta || input.length === 0) return;

    setValue(value.slice(0, cursor) + input + value.slice(cursor));
    setCursor(cursor + input.length);
  });

  const room = Math.max(1, width - label.length - 2);
  const { text, cursorIndex } = visibleWindow(value, cursor, room);
  const before = text.slice(0, cursorIndex);
  const atCursor = cursorIndex < text.length ? text[cursorIndex] : ' ';
  const after = cursorIndex < text.length ? text.slice(cursorIndex + 1) : '';

  return (
    <Box flexDirection="column">
      <Box>
        <Text>{`${label}: ${before}`}</Text>
        {color ? (
          <Text inverse>{atCursor}</Text>
        ) : (
          <>
            <Text>{'▏'}</Text>
            <Text>{atCursor}</Text>
          </>
        )}
        <Text>{after}</Text>
      </Box>
      {error !== undefined && <Text color={color ? 'red' : undefined}>{error}</Text>}
      <Text dimColor>Enter save · Esc cancel</Text>
    </Box>
  );
}

function dropTrailingEmpty(lines: string[]): string[] {
  const copy = [...lines];
  while (copy.length > 1 && copy[copy.length - 1] === '') copy.pop();
  if (copy.length === 1 && copy[0] === '') return [];
  return copy;
}

export function LinesPrompt(props: {
  label: string;
  initial: string[];
  onSubmit: (lines: string[]) => void;
  onCancel: () => void;
  validate?: (lines: string[]) => string | undefined;
  hint?: string;
  width?: number;
  color?: boolean;
  /** Ctrl+C is never swallowed by a prompt: the app wires this to "cancel
   * this prompt and start the quit flow", so a terminal program still
   * responds to the interrupt key from anywhere. */
  onCtrlC?: () => void;
}) {
  const {
    label,
    initial,
    onSubmit,
    onCancel,
    validate,
    hint,
    width = DEFAULT_WIDTH,
    color = true,
    onCtrlC,
  } = props;
  const initialLines = initial.length > 0 ? initial : [''];
  const [lines, setLines] = useState<string[]>(initialLines);
  const [row, setRow] = useState(0);
  const [col, setCol] = useState((initialLines[0] ?? '').length);
  const [error, setError] = useState<string | undefined>(undefined);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCtrlC?.();
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.ctrl && input === 's') {
      const submitted = dropTrailingEmpty(lines);
      const message = validate?.(submitted);
      if (message) {
        setError(message);
        return;
      }
      onSubmit(submitted);
      return;
    }

    setError(undefined);
    const current = lines[row] ?? '';

    if (key.upArrow) {
      if (row === 0) return;
      const nextRow = row - 1;
      setRow(nextRow);
      setCol((c) => Math.min(c, (lines[nextRow] ?? '').length));
      return;
    }
    if (key.downArrow) {
      if (row === lines.length - 1) return;
      const nextRow = row + 1;
      setRow(nextRow);
      setCol((c) => Math.min(c, (lines[nextRow] ?? '').length));
      return;
    }
    if (key.leftArrow) {
      setCol((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCol((c) => Math.min(current.length, c + 1));
      return;
    }
    if (key.return) {
      const before = current.slice(0, col);
      const after = current.slice(col);
      const next = [...lines];
      next.splice(row, 1, before, after);
      setLines(next);
      setRow(row + 1);
      setCol(0);
      return;
    }
    if (key.backspace) {
      if (col > 0) {
        const next = [...lines];
        next[row] = current.slice(0, col - 1) + current.slice(col);
        setLines(next);
        setCol(col - 1);
        return;
      }
      if (row > 0) {
        const prev = lines[row - 1] ?? '';
        const next = [...lines];
        next.splice(row - 1, 2, prev + current);
        setLines(next);
        setRow(row - 1);
        setCol(prev.length);
      }
      return;
    }
    if (key.delete) {
      const next = [...lines];
      next[row] = current.slice(0, col) + current.slice(col + 1);
      setLines(next);
      return;
    }
    if (key.ctrl || key.meta || input.length === 0) return;

    const next = [...lines];
    next[row] = current.slice(0, col) + input + current.slice(col);
    setLines(next);
    setCol(col + input.length);
  });

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      {lines.map((line, index) => {
        if (index !== row) {
          return (
            <Text key={index}>{truncate(line.length > 0 ? line : ' ', Math.max(1, width))}</Text>
          );
        }
        const before = line.slice(0, col);
        const atCursor = col < line.length ? line[col] : ' ';
        const after = col < line.length ? line.slice(col + 1) : '';
        return (
          <Box key={index}>
            <Text>{before}</Text>
            <Text inverse={color}>{atCursor}</Text>
            <Text>{after}</Text>
          </Box>
        );
      })}
      {error !== undefined && <Text color={color ? 'red' : undefined}>{error}</Text>}
      <Text dimColor>{hint ?? 'Ctrl+S save · Esc cancel'}</Text>
    </Box>
  );
}

export function ChoicePrompt(props: {
  label: string;
  options: { key: string; label: string }[];
  onPick: (key: string) => void;
  onCancel: () => void;
  /** As for the other prompts, except that the quit confirmation overrides
   * it: a second Ctrl+C while it's open force-quits instead of re-opening
   * the same confirmation. */
  onCtrlC?: () => void;
}) {
  const { label, options, onPick, onCancel, onCtrlC } = props;

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCtrlC?.();
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    const match = options.find((option) => option.key === input);
    if (match) onPick(match.key);
  });

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      {options.map((option) => (
        <Text key={option.key}>{`${option.key}  ${option.label}`}</Text>
      ))}
    </Box>
  );
}

export interface ListItem {
  key: string;
  label: string;
  disabled?: boolean;
}

/** A picker for `o` (open set): ↑/↓ or j/k move, Enter picks the selected
 * item (a no-op on a `disabled` one — invalid sets can't be opened), Esc
 * cancels. The caller supplies `items` already formatted (label text,
 * disabled flag) since only it knows what "invalid" means for its rows. */
export function ListPrompt(props: {
  label: string;
  items: ListItem[];
  onPick: (key: string) => void;
  onCancel: () => void;
  color?: boolean;
  /** Ctrl+C is never swallowed by a prompt: the app wires this to "cancel
   * this prompt and start the quit flow", so a terminal program still
   * responds to the interrupt key from anywhere. */
  onCtrlC?: () => void;
}) {
  const { label, items, onPick, onCancel, color = true, onCtrlC } = props;
  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCtrlC?.();
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow || input === 'k') {
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setIndex((i) => Math.min(items.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const item = items[index];
      if (item && !item.disabled) onPick(item.key);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      {items.map((item, i) => {
        const pointer = i === index ? '▸ ' : '  ';
        const text = `${pointer}${item.label}`;
        return (
          <Text key={item.key} dimColor={item.disabled && color} inverse={i === index}>
            {text}
          </Text>
        );
      })}
      <Text dimColor>↑↓/j k move · Enter pick · Esc cancel</Text>
    </Box>
  );
}
