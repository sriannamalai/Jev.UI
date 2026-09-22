import { describe, expect, it, vi } from 'vitest';
import type { PromptSpec } from '../src/tui/Prompts.js';
import { beginStateEdit, type StateEditorUi } from '../src/tui/StateEditor.js';

function harness() {
  let prompt: PromptSpec | undefined;
  const ui: StateEditorUi = {
    openPrompt(next) {
      prompt = next;
    },
    closePrompt: vi.fn(),
    dispatch: vi.fn(),
  };
  return {
    ui,
    get prompt() {
      return prompt;
    },
  };
}

describe('beginStateEdit', () => {
  it('requires an explicit mode then preserves multiline text exactly', () => {
    const h = harness();
    beginStateEdit(h.ui, 'old');
    expect(h.prompt).toMatchObject({ kind: 'list', label: 'Edit state as' });
    if (h.prompt?.kind !== 'list') throw new Error('Expected mode list');
    h.prompt.onPick('text');
    const textPrompt = h.prompt as PromptSpec | undefined;
    expect(textPrompt).toMatchObject({ kind: 'lines', label: 'State (Text)' });
    if (textPrompt?.kind !== 'lines') throw new Error('Expected text lines');
    textPrompt.onSubmit(['{"looks":"json"}', '', '']);
    expect(h.ui.dispatch).toHaveBeenCalledWith({
      type: 'setState',
      state: '{"looks":"json"}\n\n',
    });
  });

  it('validates JSON mode as an object or array before dispatching', () => {
    const h = harness();
    beginStateEdit(h.ui, '{"old":true}', 'json');
    expect(h.prompt).toMatchObject({ kind: 'lines', label: 'State (JSON)' });
    if (h.prompt?.kind !== 'lines') throw new Error('Expected JSON lines');
    expect(h.prompt.validate?.(['nope'])).toBe('Enter valid JSON');
    expect(h.prompt.validate?.(['42'])).toBe('JSON must be an object or array');
    h.prompt.onSubmit(['{"next":true}']);
    expect(h.ui.dispatch).toHaveBeenCalledWith({ type: 'setState', state: { next: true } });
  });

  it('defaults structured state to JSON so Enter and save preserve its type', () => {
    const h = harness();
    beginStateEdit(h.ui, { old: true });
    expect(h.prompt).toMatchObject({ kind: 'list', initialKey: 'json' });
    if (h.prompt?.kind !== 'list') throw new Error('Expected mode list');
    h.prompt.onPick('json');
    const jsonPrompt = h.prompt as PromptSpec | undefined;
    if (jsonPrompt?.kind !== 'lines') throw new Error('Expected JSON lines');
    jsonPrompt.onSubmit(jsonPrompt.initial);
    expect(h.ui.dispatch).toHaveBeenCalledWith({ type: 'setState', state: { old: true } });
  });

  it('cancels without changing state', () => {
    const h = harness();
    beginStateEdit(h.ui, { old: true });
    h.prompt!.onCancel();
    expect(h.ui.closePrompt).toHaveBeenCalledOnce();
    expect(h.ui.dispatch).not.toHaveBeenCalled();
  });
});
