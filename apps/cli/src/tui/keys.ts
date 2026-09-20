// Single entry point for the TUI's keyboard handling (spec §8.2). Kept as one
// function, routed through one `KeyContext`, so the next task (add/delete/
// rename/edit/save/export keys) can extend it here rather than scattering
// `useInput` handlers across components.
import type { Key } from 'ink';

export type Pane = 'state' | 'questions' | 'results';

export const PANES: readonly Pane[] = ['state', 'questions', 'results'];

/** Every key this slice understands, key label -> what it does. Rendered
 * verbatim by the help overlay ('?'). */
export const KEYMAP: Record<string, string> = {
  Tab: 'cycle panes',
  '1 / 2 / 3': 'jump to a pane',
  '↑ / ↓ (k/j)': 'move selection',
  r: 'run',
  '?': 'toggle this help',
  Esc: 'close help',
  q: 'quit',
};

export interface KeyContext {
  focused: Pane;
  setFocused(pane: Pane): void;
  helpVisible: boolean;
  setHelpVisible(visible: boolean): void;
  questionIds: string[];
  selectedId: string | undefined;
  select(id: string | undefined): void;
  runRequested(): void;
  exit(): void;
}

function cyclePane(current: Pane, delta: 1 | -1): Pane {
  const index = PANES.indexOf(current);
  const next = (index + delta + PANES.length) % PANES.length;
  return PANES[next]!;
}

function moveSelection(ctx: KeyContext, delta: 1 | -1): void {
  const ids = ctx.questionIds;
  if (ids.length === 0) return;
  const current = ctx.selectedId !== undefined ? ids.indexOf(ctx.selectedId) : -1;
  const base = current === -1 ? 0 : current;
  const nextIndex = Math.max(0, Math.min(ids.length - 1, base + delta));
  const nextId = ids[nextIndex];
  if (nextId !== ctx.selectedId) ctx.select(nextId);
}

export function handleKey(input: string, key: Key, ctx: KeyContext): void {
  if (input === 'q' || (key.ctrl && input === 'c')) {
    ctx.exit();
    return;
  }

  if (ctx.helpVisible) {
    if (key.escape) ctx.setHelpVisible(false);
    return;
  }

  if (input === '?') {
    ctx.setHelpVisible(true);
    return;
  }

  if (key.escape) {
    return;
  }

  if (key.tab) {
    ctx.setFocused(cyclePane(ctx.focused, key.shift ? -1 : 1));
    return;
  }

  if (input === '1') {
    ctx.setFocused('state');
    return;
  }
  if (input === '2') {
    ctx.setFocused('questions');
    return;
  }
  if (input === '3') {
    ctx.setFocused('results');
    return;
  }

  if (ctx.focused === 'questions' && (key.downArrow || input === 'j')) {
    moveSelection(ctx, 1);
    return;
  }
  if (ctx.focused === 'questions' && (key.upArrow || input === 'k')) {
    moveSelection(ctx, -1);
    return;
  }

  if (input === 'r') {
    ctx.runRequested();
  }
}
