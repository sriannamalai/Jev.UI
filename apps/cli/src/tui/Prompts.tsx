// Small hand-rolled text editors for the TUI's edit keys.
// `ink-text-input` isn't a dependency here — these build directly on Ink's
// `useInput` so the editing model (cursor, scrolling, validation) stays in
// one place and is exercised the same way `handleKey` is.
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { displayWidth, truncate } from './bars.js';

const DEFAULT_WIDTH = 60;

export interface PromptProgress {
  current: number;
  total: number;
}

export interface PromptPresentation {
  width?: number;
  height?: number;
  context?: string;
  progress?: PromptProgress;
  submitLabel?: string;
}

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

function normalizePastedInput(value: string): string {
  return value
    .replace(/\u001B\[200~/g, '')
    .replace(/\u001B\[201~/g, '')
    .replace(/\r\n?/g, '\n');
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
  const rawAtCursor = index < count ? cells[index]! : ' ';
  // A two-column grapheme cannot be shown inside a one-column viewport.
  // Render a cursor marker in its place; the stored grapheme is untouched.
  const atCursor = displayWidth(rawAtCursor) > room ? '▏' : rawAtCursor;

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
  height?: number;
  context?: string;
  progress?: PromptProgress;
  submitLabel?: string;
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
    height,
    color = true,
    onCtrlC,
    context,
    progress,
    submitLabel = 'save',
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

    const inserted = normalizePastedInput(input).replace(/\n/g, ' ');
    setValue(cells.slice(0, at).join('') + inserted + cells.slice(at).join(''));
    setCursor(at + graphemes(inserted).length);
  });

  const prefixRoom = Math.max(0, width - 1);
  const prefix = prefixRoom > 0 ? truncate(`${label}: `, prefixRoom) : '';
  const editorRoom = Math.max(1, width - displayWidth(prefix));
  const room = Math.max(1, editorRoom - (color ? 0 : 1));
  const { before, atCursor, after } = visibleWindow(graphemes(value), cursor, room);
  let extraRows = height === undefined ? Number.POSITIVE_INFINITY : Math.max(0, height - 1);
  const showError = error !== undefined && extraRows-- > 0;
  const showFooter = extraRows-- > 0;
  const showProgress = progress !== undefined && extraRows-- > 0;
  const showContext = context !== undefined && extraRows-- > 0;

  if (height === 0) return <Box height={0} overflow="hidden" />;

  return (
    <Box flexDirection="column">
      {showContext && <Text dimColor={color}>{truncate(context, Math.max(1, width))}</Text>}
      {showProgress && (
        <Text dimColor={color}>
          {truncate(`Step ${progress.current}/${progress.total}`, Math.max(1, width))}
        </Text>
      )}
      <Box>
        <Text>{`${prefix}${before}`}</Text>
        {color ? (
          <Text inverse>{atCursor}</Text>
        ) : (
          <>
            <Text>{'▏'}</Text>
            {editorRoom > 1 && <Text>{atCursor}</Text>}
          </>
        )}
        <Text>{after}</Text>
      </Box>
      {showError && (
        <Text color={color ? 'red' : undefined}>{truncate(error, Math.max(1, width))}</Text>
      )}
      {showFooter && (
        <Text dimColor={color}>
          {truncate(`Enter ${submitLabel} · Esc cancel`, Math.max(1, width))}
        </Text>
      )}
    </Box>
  );
}

export function LinesPrompt(props: {
  label: string;
  initial: string[];
  onSubmit: (lines: string[]) => void;
  onCancel: () => void;
  validate?: (lines: string[]) => string | undefined;
  hint?: string;
  width?: number;
  height?: number;
  context?: string;
  progress?: PromptProgress;
  submitLabel?: string;
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
    height,
    context,
    progress,
    submitLabel = 'save',
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
      const submitted = lines;
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

    const inserted = normalizePastedInput(input);
    const pastedLines = inserted.split('\n');
    const before = cells.slice(0, at).join('');
    const after = cells.slice(at).join('');
    const replacement =
      pastedLines.length === 1
        ? [`${before}${pastedLines[0] ?? ''}${after}`]
        : [
            `${before}${pastedLines[0] ?? ''}`,
            ...pastedLines.slice(1, -1),
            `${pastedLines.at(-1) ?? ''}${after}`,
          ];
    const next = [...lines];
    next.splice(row, 1, ...replacement);
    setLines(next);
    setRow(row + replacement.length - 1);
    setCol(
      replacement.length === 1
        ? at + graphemes(pastedLines[0] ?? '').length
        : graphemes(pastedLines.at(-1) ?? '').length,
    );
  });

  let chromeRows = height === undefined ? Number.POSITIVE_INFINITY : Math.max(0, height - 1);
  const showError = error !== undefined && chromeRows-- > 0;
  const showLabel = chromeRows-- > 0;
  const showFooter = chromeRows-- > 0;
  const showProgress = progress !== undefined && chromeRows-- > 0;
  const showContext = context !== undefined && chromeRows-- > 0;
  const usedChrome = [showError, showLabel, showFooter, showProgress, showContext].filter(
    Boolean,
  ).length;
  const bodyRows =
    height === undefined ? lines.length : Math.max(1, Math.max(0, height) - usedChrome);
  const firstVisible = Math.max(0, Math.min(row - bodyRows + 1, lines.length - bodyRows));
  const visibleLines = lines.slice(firstVisible, firstVisible + bodyRows);

  if (height === 0) return <Box height={0} overflow="hidden" />;

  return (
    <Box flexDirection="column">
      {showLabel && <Text>{truncate(label, Math.max(1, width))}</Text>}
      {showContext && <Text dimColor={color}>{truncate(context, Math.max(1, width))}</Text>}
      {showProgress && (
        <Text dimColor={color}>
          {truncate(`Step ${progress.current}/${progress.total}`, Math.max(1, width))}
        </Text>
      )}
      {visibleLines.map((line, visibleIndex) => {
        const index = firstVisible + visibleIndex;
        if (index !== row) {
          return (
            <Text key={index}>{truncate(line.length > 0 ? line : ' ', Math.max(1, width))}</Text>
          );
        }
        // The cursor row scrolls with the cursor instead of being truncated,
        // but obeys the same display-width bound as the rows around it.
        const editorRoom = Math.max(1, width - (color ? 0 : 1));
        const { before, atCursor, after } = visibleWindow(graphemes(line), col, editorRoom);
        return (
          <Box key={index}>
            <Text>{before}</Text>
            {color ? <Text inverse>{atCursor}</Text> : <Text>{'▏'}</Text>}
            {!color && width > 1 && <Text>{atCursor}</Text>}
            <Text>{after}</Text>
          </Box>
        );
      })}
      {showError && (
        <Text color={color ? 'red' : undefined}>{truncate(error, Math.max(1, width))}</Text>
      )}
      {showFooter && (
        <Text dimColor={color}>
          {truncate(hint ?? `Ctrl+S ${submitLabel} · Esc cancel`, Math.max(1, width))}
        </Text>
      )}
    </Box>
  );
}

export function ChoicePrompt(props: {
  label: string;
  options: { key: string; label: string }[];
  onPick: (key: string) => void;
  onCancel: () => void;
  defaultKey?: string;
  width?: number;
  height?: number;
  context?: string;
  progress?: PromptProgress;
  color?: boolean;
  /** As for the other prompts, except that the quit confirmation overrides
   * it: a second Ctrl+C while it's open force-quits instead of re-opening
   * the same confirmation. */
  onCtrlC?: () => void;
}) {
  const {
    label,
    options,
    onPick,
    onCancel,
    onCtrlC,
    defaultKey,
    width = DEFAULT_WIDTH,
    height,
    context,
    progress,
    color = true,
  } = props;
  const defaultIndex = Math.max(
    0,
    options.findIndex((option) => option.key === defaultKey),
  );
  const [index, setIndex] = useState(defaultIndex);

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
      setIndex((i) => Math.min(options.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const option = options[index];
      if (option) onPick(option.key);
      return;
    }
    const match = options.find((option) => option.key === input);
    if (match) onPick(match.key);
  });

  let chromeRows = height === undefined ? Number.POSITIVE_INFINITY : Math.max(0, height - 1);
  const showLabel = chromeRows-- > 0;
  const showFooter = chromeRows-- > 0;
  const showProgress = progress !== undefined && chromeRows-- > 0;
  const showContext = context !== undefined && chromeRows-- > 0;
  const usedChrome = [showLabel, showFooter, showProgress, showContext].filter(Boolean).length;
  const bodyRows =
    height === undefined ? options.length : Math.max(1, Math.max(0, height) - usedChrome);
  const firstVisible = Math.max(0, Math.min(index - bodyRows + 1, options.length - bodyRows));
  if (height === 0) return <Box height={0} overflow="hidden" />;
  return (
    <Box flexDirection="column">
      {showLabel && <Text>{truncate(label, Math.max(1, width))}</Text>}
      {showContext && <Text dimColor={color}>{truncate(context, Math.max(1, width))}</Text>}
      {showProgress && (
        <Text dimColor={color}>
          {truncate(`Step ${progress.current}/${progress.total}`, Math.max(1, width))}
        </Text>
      )}
      {options.slice(firstVisible, firstVisible + bodyRows).map((option, visibleIndex) => {
        const optionIndex = firstVisible + visibleIndex;
        return (
          <Text key={option.key} inverse={color && optionIndex === index}>
            {truncate(`${optionIndex === index ? '▸' : ' '} ${option.key}  ${option.label}`, width)}
          </Text>
        );
      })}
      {showFooter && (
        <Text dimColor={color}>{truncate('↑↓/j k move · Enter pick · Esc cancel', width)}</Text>
      )}
    </Box>
  );
}

export interface ListItem {
  key: string;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
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
  width?: number;
  height?: number;
  context?: string;
  progress?: PromptProgress;
  initialKey?: string;
  defaultKey?: string;
  /** Ctrl+C is never swallowed by a prompt: the app wires this to "cancel
   * this prompt and start the quit flow", so a terminal program still
   * responds to the interrupt key from anywhere. */
  onCtrlC?: () => void;
}) {
  const {
    label,
    items,
    onPick,
    onCancel,
    color = true,
    onCtrlC,
    width = DEFAULT_WIDTH,
    height,
    context,
    progress,
    initialKey,
    defaultKey,
  } = props;
  const selectedKey = initialKey ?? defaultKey;
  const selectedIndex = items.findIndex((item) => item.key === selectedKey);
  const [index, setIndex] = useState(Math.max(0, selectedIndex));

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
      return;
    }
    const shortcut = items.find((item) => item.key.length === 1 && item.key === input);
    if (shortcut && !shortcut.disabled) onPick(shortcut.key);
  });

  let chromeRows = height === undefined ? Number.POSITIVE_INFINITY : Math.max(0, height - 1);
  const showLabel = chromeRows-- > 0;
  const showFooter = chromeRows-- > 0;
  const showProgress = progress !== undefined && chromeRows-- > 0;
  const showContext = context !== undefined && chromeRows-- > 0;
  const usedChrome = [showLabel, showFooter, showProgress, showContext].filter(Boolean).length;
  const bodyRows =
    height === undefined ? items.length : Math.max(1, Math.max(0, height) - usedChrome);
  const firstVisible = Math.max(0, Math.min(index - bodyRows + 1, items.length - bodyRows));
  if (height === 0) return <Box height={0} overflow="hidden" />;
  return (
    <Box flexDirection="column">
      {showLabel && <Text>{truncate(label, Math.max(1, width))}</Text>}
      {showContext && <Text dimColor={color}>{truncate(context, Math.max(1, width))}</Text>}
      {showProgress && (
        <Text dimColor={color}>
          {truncate(`Step ${progress.current}/${progress.total}`, Math.max(1, width))}
        </Text>
      )}
      {items.slice(firstVisible, firstVisible + bodyRows).map((item, visibleIndex) => {
        const i = firstVisible + visibleIndex;
        const pointer = i === index ? '▸ ' : '  ';
        const reason = item.disabledReason ? ` — ${item.disabledReason}` : '';
        const text = truncate(`${pointer}${item.label}${reason}`, width);
        return (
          <Text key={item.key} dimColor={item.disabled && color} inverse={color && i === index}>
            {text}
          </Text>
        );
      })}
      {showFooter && (
        <Text dimColor={color}>{truncate('↑↓/j k move · Enter pick · Esc cancel', width)}</Text>
      )}
    </Box>
  );
}

/** What `App` hands to its prompt host: which prompt to show and what its
 * callbacks do. The four kinds mirror the four prompt components above. */
export type PromptSpec = PromptPresentation &
  (
    | {
        kind: 'text';
        label: string;
        initial: string;
        validate?: (value: string) => string | undefined;
        onSubmit: (value: string) => void;
        onCancel: () => void;
        onCtrlC?: () => void;
      }
    | {
        kind: 'lines';
        label: string;
        initial: string[];
        validate?: (lines: string[]) => string | undefined;
        hint?: string;
        onSubmit: (lines: string[]) => void;
        onCancel: () => void;
        onCtrlC?: () => void;
      }
    | {
        kind: 'choice';
        label: string;
        options: { key: string; label: string }[];
        onPick: (key: string) => void;
        onCancel: () => void;
        onCtrlC?: () => void;
        defaultKey?: string;
      }
    | {
        kind: 'list';
        label: string;
        items: ListItem[];
        onPick: (key: string) => void;
        onCancel: () => void;
        onCtrlC?: () => void;
        initialKey?: string;
        defaultKey?: string;
      }
  );
