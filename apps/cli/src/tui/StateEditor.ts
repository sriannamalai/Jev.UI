import type { Text, workbenchReducer } from '@jev-ui/core';
import type { PromptSpec } from './Prompts.js';
import { parseStructuredLines, structuredToLines } from './questionEdit.js';

type WorkbenchAction = Parameters<typeof workbenchReducer>[1];

export type StateEditMode = 'text' | 'json';

export interface StateEditorUi {
  openPrompt(spec: PromptSpec): void;
  closePrompt(): void;
  dispatch(action: WorkbenchAction): void;
  setNotice?(text: string | undefined): void;
}

function textLines(value: Text): string[] {
  return typeof value === 'string' ? value.split('\n') : structuredToLines(value);
}

function openStateValueEditor(ui: StateEditorUi, value: Text, mode: StateEditMode): void {
  const common = {
    kind: 'lines' as const,
    initial: textLines(value),
    context: `Mode: ${mode === 'text' ? 'Text' : 'JSON'}`,
    submitLabel: 'Save',
    onCancel: ui.closePrompt,
  };

  if (mode === 'text') {
    ui.openPrompt({
      ...common,
      label: 'State (Text)',
      onSubmit: (lines: string[]) => {
        ui.closePrompt();
        ui.dispatch({ type: 'setState', state: lines.join('\n') });
      },
    });
    return;
  }

  ui.openPrompt({
    ...common,
    label: 'State (JSON)',
    validate: (lines: string[]) => {
      const result = parseStructuredLines(lines);
      return result.ok ? undefined : result.message;
    },
    onSubmit: (lines: string[]) => {
      const result = parseStructuredLines(lines);
      if (!result.ok) return;
      ui.closePrompt();
      ui.dispatch({ type: 'setState', state: result.value });
    },
  });
}

/** Starts the built-in state editor. Without `initialMode`, the user must
 * explicitly choose Text or JSON, so JSON-looking strings never change type
 * merely because of their contents. */
export function beginStateEdit(ui: StateEditorUi, value: Text, initialMode?: StateEditMode): void {
  if (initialMode !== undefined) {
    openStateValueEditor(ui, value, initialMode);
    return;
  }
  ui.openPrompt({
    kind: 'list',
    label: 'Edit state as',
    context: typeof value === 'string' ? 'Current value: Text' : 'Current value: JSON',
    initialKey: typeof value === 'string' ? 'text' : 'json',
    items: [
      { key: 'text', label: 'Text' },
      { key: 'json', label: 'JSON object or array' },
    ],
    onPick: (key) => {
      if (key === 'text' || key === 'json') openStateValueEditor(ui, value, key);
    },
    onCancel: ui.closePrompt,
  });
}
