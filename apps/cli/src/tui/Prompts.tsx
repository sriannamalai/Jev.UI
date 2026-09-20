// Small hand-rolled text editors for the TUI's edit keys (spec §8.2).
// `ink-text-input` isn't a dependency here — these build directly on Ink's
// `useInput` so the editing model (cursor, scrolling, validation) stays in
// one place and is exercised the same way `handleKey` is.
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { displayWidth, truncate } from './bars.js';

const DEFAULT_WIDTH = 60;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** `value` split into grapheme clusters. Cursor positions are indices into
 * this array — never UTF-16 offsets — so ←/→/Backspace/Delete can never cut
 * a surrogate pair or a ZWJ sequence (a family emoji) in half. */
function graphemes(value: string): string[] {
  return Array.from(segmenter.segment(value), (entry) => entry.segment);
}

function clampCursor(cells: string[], cursor: number): number {
  return Math.max(0, Math.min(cells.length, cursor));
}

interface CursorWindow {
  before: string;
  atCursor: string;
  after: string;
}

/** The slice of `cells` that fits `width` DISPLAY columns (not code units)
 * while keeping the cursor visible, scrolling horizontally when the text is
 * wider than the available room. The cursor sits on its own cell — the
 * grapheme it is over, or a trailing space at the end of the value — and
 * that cell's width is part of the budget, so the exact-fit case is handled
 * by the accounting rather than by an off-by-one comparison. */
function visibleWindow(cells: string[], cursor: number, width: number): CursorWindow {
  const room = Math.max(1, width);
  const count = cells.length;
  const index = clampCursor(cells, cursor);
  const atCursor = index < count ? cells[index]! : ' ';

  let total = Math.max(1, displayWidth(atCursor));
  let start = index;
  let end = Math.min(index + 1, count);

  while (start > 0) {
    const cellWidth = displayWidth(cells[start - 1]!);
    if (total + cellWidth > room) break;
    total += cellWidth;
    start -= 1;
  }
  while (end < count) {
    const cellWidth = displayWidth(cells[end]!);
    if (total + cellWidth > room) break;
    total += cellWidth;
    end += 1;
  }

  return {
    before: cells.slice(start, index).join(''),
    atCursor,
    after: cells.slice(Math.min(index + 1, count), end).join(''),
  };
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
  const [cursor, setCursor] = useState(() => graphemes(initial).length);
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
    const cells = graphemes(value);
    const at = clampCursor(cells, cursor);

    // Several arrow keys can arrive in one chunk, so cursor moves are
    // functional updates: computing from the captured `cursor` would apply
    // only the last of them.
    if (key.leftArrow) {
      setCursor((c) => clampCursor(cells, clampCursor(cells, c) - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => clampCursor(cells, clampCursor(cells, c) + 1));
      return;
    }
    if (key.home || (key.ctrl && input === 'a')) {
      setCursor(0);
      return;
    }
    if (key.end || (key.ctrl && input === 'e')) {
      setCursor(cells.length);
      return;
    }
    if (key.backspace) {
      if (at === 0) return;
      setValue(cells.slice(0, at - 1).join('') + cells.slice(at).join(''));
      setCursor(at - 1);
      return;
    }
    if (key.delete) {
      setValue(cells.slice(0, at).join('') + cells.slice(at + 1).join(''));
      return;
    }
    if (key.ctrl || key.meta || input.length === 0) return;

    setValue(cells.slice(0, at).join('') + input + cells.slice(at).join(''));
    setCursor(at + graphemes(input).length);
  });

  // The label is measured in display columns too ("状態: " is 6 wide, not 4).
  const room = Math.max(1, width - displayWidth(label) - 2);
  const { before, atCursor, after } = visibleWindow(graphemes(value), cursor, room);

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
      {error !== undefined && (
        <Text color={color ? 'red' : undefined}>{truncate(error, Math.max(1, width))}</Text>
      )}
      <Text dimColor>{truncate('Enter save · Esc cancel', Math.max(1, width))}</Text>
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
  const [col, setCol] = useState(() => graphemes(initialLines[0] ?? '').length);
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
    const cells = graphemes(current);
    const at = clampCursor(cells, col);

    if (key.upArrow) {
      if (row === 0) return;
      const nextRow = row - 1;
      setRow(nextRow);
      setCol((c) => Math.min(c, graphemes(lines[nextRow] ?? '').length));
      return;
    }
    if (key.downArrow) {
      if (row === lines.length - 1) return;
      const nextRow = row + 1;
      setRow(nextRow);
      setCol((c) => Math.min(c, graphemes(lines[nextRow] ?? '').length));
      return;
    }
    // See TextPrompt: a chunk can carry several arrow keys.
    if (key.leftArrow) {
      setCol((c) => Math.max(0, clampCursor(cells, c) - 1));
      return;
    }
    if (key.rightArrow) {
      setCol((c) => Math.min(cells.length, clampCursor(cells, c) + 1));
      return;
    }
    if (key.return) {
      const before = cells.slice(0, at).join('');
      const after = cells.slice(at).join('');
      const next = [...lines];
      next.splice(row, 1, before, after);
      setLines(next);
      setRow(row + 1);
      setCol(0);
      return;
    }
    if (key.backspace) {
      if (at > 0) {
        const next = [...lines];
        next[row] = cells.slice(0, at - 1).join('') + cells.slice(at).join('');
        setLines(next);
        setCol(at - 1);
        return;
      }
      if (row > 0) {
        const prev = lines[row - 1] ?? '';
        const next = [...lines];
        next.splice(row - 1, 2, prev + current);
        setLines(next);
        setRow(row - 1);
        setCol(graphemes(prev).length);
      }
      return;
    }
    if (key.delete) {
      const next = [...lines];
      next[row] = cells.slice(0, at).join('') + cells.slice(at + 1).join('');
      setLines(next);
      return;
    }
    if (key.ctrl || key.meta || input.length === 0) return;

    const next = [...lines];
    next[row] = cells.slice(0, at).join('') + input + cells.slice(at).join('');
    setLines(next);
    setCol(at + graphemes(input).length);
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
        // The cursor row scrolls with the cursor instead of being truncated,
        // but obeys the same display-width bound as the rows around it.
        const { before, atCursor, after } = visibleWindow(graphemes(line), col, width);
        return (
          <Box key={index}>
            <Text>{before}</Text>
            <Text inverse={color}>{atCursor}</Text>
            <Text>{after}</Text>
          </Box>
        );
      })}
      {error !== undefined && (
        <Text color={color ? 'red' : undefined}>{truncate(error, Math.max(1, width))}</Text>
      )}
      <Text dimColor>
        {truncate(hint ?? 'Ctrl+S save · Esc cancel', Math.max(1, width))}
      </Text>
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
