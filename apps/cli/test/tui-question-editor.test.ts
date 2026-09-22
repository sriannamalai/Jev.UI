import { describe, expect, it, vi } from 'vitest';
import type { Question } from '@jev-ui/core';
import type { PromptSpec } from '../src/tui/Prompts.js';
import { beginQuestionEdit, type QuestionEditorUi } from '../src/tui/QuestionEditor.js';

function harness() {
  let prompt: PromptSpec | undefined;
  const ui: QuestionEditorUi = {
    openPrompt(next) {
      prompt = next;
    },
    closePrompt: vi.fn(),
    setNotice: vi.fn(),
    dispatch: vi.fn(),
  };
  return {
    ui,
    get prompt() {
      return prompt;
    },
  };
}

function submit(prompt: PromptSpec, value: string | string[]): void {
  if (prompt.kind === 'text' && typeof value === 'string') prompt.onSubmit(value);
  else if (prompt.kind === 'lines' && Array.isArray(value)) prompt.onSubmit(value);
  else throw new Error(`Cannot submit ${prompt.kind}`);
}

describe('beginQuestionEdit', () => {
  it('commits one atomic update only after the final step', () => {
    const h = harness();
    const original: Question = {
      type: 'choice',
      instructions: 'Old',
      criteria: { a: 'Alpha' },
    };
    beginQuestionEdit(h.ui, 'kind', original);
    expect(h.prompt).toMatchObject({ kind: 'text', submitLabel: 'Next' });
    submit(h.prompt!, 'New');
    expect(h.ui.dispatch).not.toHaveBeenCalled();
    expect(h.prompt).toMatchObject({ kind: 'lines', submitLabel: 'Save' });
    submit(h.prompt!, ['b: Beta']);
    expect(h.ui.dispatch).toHaveBeenCalledOnce();
    expect(h.ui.dispatch).toHaveBeenCalledWith({
      type: 'updateQuestion',
      id: 'kind',
      question: { type: 'choice', instructions: 'New', criteria: { b: 'Beta' } },
    });
  });

  it('defers a new question to onComplete without dispatching an update', () => {
    const h = harness();
    const onComplete = vi.fn();
    const provisional: Question = {
      type: 'choice',
      instructions: '',
      criteria: { option: null },
    };
    beginQuestionEdit(h.ui, 'choice_2', provisional, { onComplete });
    submit(h.prompt!, 'Choose one');
    submit(h.prompt!, ['yes: Yes']);
    expect(h.ui.dispatch).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith({
      type: 'choice',
      instructions: 'Choose one',
      criteria: { yes: 'Yes' },
    });
  });

  it('cancels after an earlier step without changing the original', () => {
    const h = harness();
    const onCancel = vi.fn();
    const original: Question = {
      type: 'score',
      instructions: 'Old',
      criteria: ['Low', 'High'],
    };
    beginQuestionEdit(h.ui, 'score', original, { onCancel });
    submit(h.prompt!, 'Changed draft');
    h.prompt!.onCancel();
    expect(h.ui.dispatch).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(original).toEqual({
      type: 'score',
      instructions: 'Old',
      criteria: ['Low', 'High'],
    });
  });

  it('edits structured instructions as validated JSON', () => {
    const h = harness();
    const original: Question = {
      type: 'choice',
      instructions: { nested: ['old'] },
      criteria: { a: null },
    };
    beginQuestionEdit(h.ui, 'choice', original);
    expect(h.prompt).toMatchObject({ kind: 'lines', label: 'Instructions (JSON)' });
    if (h.prompt?.kind !== 'lines') throw new Error('Expected lines prompt');
    expect(h.prompt.validate?.(['"string"'])).toBe('JSON must be an object or array');
    h.prompt.onSubmit(['{', '  "nested": ["new"]', '}']);
    submit(h.prompt!, ['a:']);
    expect(h.ui.dispatch).toHaveBeenCalledWith({
      type: 'updateQuestion',
      id: 'choice',
      question: { type: 'choice', instructions: { nested: ['new'] }, criteria: { a: null } },
    });
  });

  it('keeps JSON-looking string instructions as strings', () => {
    const h = harness();
    const original: Question = {
      type: 'score',
      instructions: '{"looks":"json"}',
      criteria: ['Low', 'High'],
    };
    beginQuestionEdit(h.ui, 'score', original);
    expect(h.prompt).toMatchObject({ kind: 'text', initial: '{"looks":"json"}' });
    submit(h.prompt!, '{"still":"text"}');
    submit(h.prompt!, ['Low', 'High']);
    expect(h.ui.dispatch).toHaveBeenCalledWith({
      type: 'updateQuestion',
      id: 'score',
      question: {
        type: 'score',
        instructions: '{"still":"text"}',
        criteria: ['Low', 'High'],
      },
    });
  });

  it('edits multiline string instructions without flattening or losing trailing newlines', () => {
    const h = harness();
    const original: Question = {
      type: 'score',
      instructions: 'First\nSecond\n',
      criteria: ['Low', 'High'],
    };
    beginQuestionEdit(h.ui, 'score', original);
    expect(h.prompt).toMatchObject({
      kind: 'lines',
      label: 'Instructions',
      initial: ['First', 'Second', ''],
    });
    submit(h.prompt!, ['Changed', '', '']);
    submit(h.prompt!, ['Low', 'High']);
    expect(h.ui.dispatch).toHaveBeenCalledWith({
      type: 'updateQuestion',
      id: 'score',
      question: {
        type: 'score',
        instructions: 'Changed\n\n',
        criteria: ['Low', 'High'],
      },
    });
  });

  it('edits structured noul criteria as JSON without clearing it', () => {
    const h = harness();
    const original: Question = {
      type: 'noul',
      instructions: 'Judge',
      criteria: { true: { signal: 'yes' }, false: ['no'] },
    };
    beginQuestionEdit(h.ui, 'noul', original);
    submit(h.prompt!, 'Judge');
    expect(h.prompt).toMatchObject({ kind: 'lines', label: 'Yes means (JSON)' });
    submit(h.prompt!, ['{"signal":"definitely"}']);
    expect(h.prompt).toMatchObject({ kind: 'lines', label: 'No means (JSON)' });
    submit(h.prompt!, ['["never"]']);
    expect(h.ui.dispatch).toHaveBeenCalledWith({
      type: 'updateQuestion',
      id: 'noul',
      question: {
        type: 'noul',
        instructions: 'Judge',
        criteria: { true: { signal: 'definitely' }, false: ['never'] },
      },
    });
  });
});
