// Single entry point for the TUI's keyboard handling. Kept as one function,
// routed through one `KeyContext`, so further commands (sets, export, $EDITOR,
// the quit confirmation) extend it here rather than scattering `useInput`
// handlers across components.
import type { Key } from 'ink';

export type Pane = 'state' | 'questions' | 'results';

export const PANES: readonly Pane[] = ['state', 'questions', 'results'];

/** The UI's input mode. In `prompt` mode `handleKey` does nothing at all —
 * the open prompt component owns `useInput` instead (App disables this
 * handler's hook via `isActive` while a prompt is open, but `handleKey`
 * also short-circuits defensively). `help` shows the key reference
 * overlay; only Esc does anything while it's open. */
export type Mode = 'normal' | 'prompt' | 'help';

/** The complete TUI keymap, key label -> what it does. Rendered verbatim by
 * the help overlay ('?'), grouped by `KEY_GROUPS`. */
export const KEYMAP: Record<string, string> = {
  Tab: 'cycle panes',
  '1 / 2 / 3': 'jump to a pane',
  '↑ / ↓ (k/j)': 'move selection',
  r: 'run',
  a: 'add question',
  d: 'delete question',
  D: 'duplicate question',
  'J / K': 'move question down / up',
  Enter: 'edit selected question (Questions pane)',
  n: 'rename selected question',
  i: 'edit state (single line)',
  m: 'set model',
  o: 'open a saved set',
  s: 'save (prompts for a name the first time)',
  S: 'save as (always prompts for a name)',
  e: 'export as cURL / Python / TypeScript',
  E: 'edit the full request as JSON in $EDITOR',
  '?': 'show help (Esc closes)',
  Esc: 'close help / cancel a prompt',
  q: 'quit (confirms first if there are unsaved changes)',
};

/** `'?'`'s grouping of `KEYMAP` into short headings. Every `KEYMAP` key
 * appears in exactly one group; the help overlay renders group-by-group. */
export const KEY_GROUPS: { heading: string; keys: string[] }[] = [
  { heading: 'Navigate', keys: ['Tab', '1 / 2 / 3', '↑ / ↓ (k/j)'] },
  { heading: 'Run', keys: ['r'] },
  { heading: 'Edit', keys: ['a', 'd', 'D', 'J / K', 'Enter', 'n', 'i', 'm'] },
  { heading: 'Sets & export', keys: ['o', 's', 'S', 'e', 'E'] },
  { heading: 'App', keys: ['?', 'Esc', 'q'] },
];

export interface KeyContext {
  focused: Pane;
  setFocused(pane: Pane): void;
  mode: Mode;
  setMode(mode: Mode): void;
  questionIds: string[];
  selectedId: string | undefined;
  select(id: string | undefined): void;
  runRequested(): void;
  exit(): void;
  addQuestion(): void;
  deleteQuestion(): void;
  duplicateQuestion(): void;
  moveQuestion(delta: -1 | 1): void;
  editSelected(): void;
  renameSelected(): void;
  editState(): void;
  editModel(): void;
  openSet(): void;
  save(forcePrompt: boolean): void;
  exportFlow(): void;
  editInEditor(): void;
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
  // A prompt is open and owns all input; this handler is normally disabled
  // (via useInput's `isActive`) while that's the case, but this guard keeps
  // `handleKey` itself a no-op too, so it's safe to call directly.
  if (ctx.mode === 'prompt') return;

  if (input === 'q' || (key.ctrl && input === 'c')) {
    ctx.exit();
    return;
  }

  if (ctx.mode === 'help') {
    if (key.escape) ctx.setMode('normal');
    return;
  }

  if (input === '?') {
    ctx.setMode('help');
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

  if (key.return && ctx.focused === 'questions') {
    ctx.editSelected();
    return;
  }

  if (input === 'a') {
    ctx.addQuestion();
    return;
  }
  if (input === 'd') {
    ctx.deleteQuestion();
    return;
  }
  if (input === 'D') {
    ctx.duplicateQuestion();
    return;
  }
  if (input === 'J') {
    ctx.moveQuestion(1);
    return;
  }
  if (input === 'K') {
    ctx.moveQuestion(-1);
    return;
  }
  if (input === 'n') {
    ctx.renameSelected();
    return;
  }
  if (input === 'i') {
    ctx.editState();
    return;
  }
  if (input === 'm') {
    ctx.editModel();
    return;
  }
  if (input === 'o') {
    ctx.openSet();
    return;
  }
  if (input === 'S') {
    ctx.save(true);
    return;
  }
  if (input === 's') {
    ctx.save(false);
    return;
  }
  if (input === 'e') {
    ctx.exportFlow();
    return;
  }
  if (input === 'E') {
    ctx.editInEditor();
    return;
  }

  if (input === 'r') {
    ctx.runRequested();
  }
}
