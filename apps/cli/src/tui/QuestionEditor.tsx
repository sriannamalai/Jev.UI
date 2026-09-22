// Atomic question editing: each prompt updates a private draft and the
// workbench receives one updateQuestion action only after the last step.
import type { NoulQuestion, Question, Text, workbenchReducer } from '@jev-ui/core';
import type { PromptSpec } from './Prompts.js';
import {
  choiceToLines,
  editableText,
  linesToChoice,
  linesToScore,
  parseStructuredLines,
  scoreToLines,
  structuredToLines,
} from './questionEdit.js';

type WorkbenchAction = Parameters<typeof workbenchReducer>[1];
type EditStep = 'instructions' | 'yes' | 'no' | 'options' | 'levels';

export interface QuestionEditorUi {
  openPrompt(spec: PromptSpec): void;
  closePrompt(): void;
  setNotice(text: string | undefined): void;
  dispatch(action: WorkbenchAction): void;
}

export interface QuestionEditOptions {
  /** Called after the private draft is cancelled without a workbench mutation. */
  onCancel?: () => void;
  /** Lets add-question defer all workbench mutations until the draft is complete. */
  onComplete?: (question: Question) => void;
}

export function buildEditSteps(question: Question): EditStep[] {
  switch (question.type) {
    case 'noul':
      return ['instructions', 'yes', 'no'];
    case 'choice':
      return ['instructions', 'options'];
    case 'score':
      return ['instructions', 'levels'];
  }
}

function valuePrompt(
  value: Text | undefined,
  label: string,
  presentation: Pick<PromptSpec, 'context' | 'progress' | 'submitLabel'>,
  onSubmit: (value: Text) => void,
  onCancel: () => void,
): PromptSpec {
  const editable = editableText(value);
  if (editable.editable) {
    if (editable.text.includes('\n')) {
      return {
        kind: 'lines',
        label,
        initial: editable.text.split('\n'),
        ...presentation,
        onSubmit: (lines) => onSubmit(lines.join('\n')),
        onCancel,
      };
    }
    return {
      kind: 'text',
      label,
      initial: editable.text,
      ...presentation,
      onSubmit,
      onCancel,
    };
  }
  if (value === undefined || typeof value === 'string') {
    throw new Error('Structured editor requires an object or array');
  }
  return {
    kind: 'lines',
    label: `${label} (JSON)`,
    initial: structuredToLines(value),
    ...presentation,
    validate: (lines) => {
      const result = parseStructuredLines(lines);
      return result.ok ? undefined : result.message;
    },
    onSubmit: (lines) => {
      const result = parseStructuredLines(lines);
      if (result.ok) onSubmit(result.value);
    },
    onCancel,
  };
}

function runEditStep(
  ui: QuestionEditorUi,
  id: string,
  draft: Question,
  steps: EditStep[],
  index: number,
  options: QuestionEditOptions,
): void {
  const cancel = () => {
    ui.closePrompt();
    options.onCancel?.();
  };
  if (index >= steps.length) {
    ui.closePrompt();
    if (options.onComplete) options.onComplete(draft);
    else ui.dispatch({ type: 'updateQuestion', id, question: draft });
    return;
  }

  const step = steps[index]!;
  const presentation = {
    context: `Question: ${id}`,
    progress: { current: index + 1, total: steps.length },
    submitLabel: index === steps.length - 1 ? 'Save' : 'Next',
  } as const;
  const advance = (updated: Question) => {
    runEditStep(ui, id, updated, steps, index + 1, options);
  };

  if (step === 'instructions') {
    ui.openPrompt(
      valuePrompt(
        draft.instructions,
        'Instructions',
        presentation,
        (instructions) => advance({ ...draft, instructions }),
        cancel,
      ),
    );
    return;
  }

  if (step === 'yes' || step === 'no') {
    if (draft.type !== 'noul') return;
    const criteriaKey = step === 'yes' ? ('true' as const) : ('false' as const);
    const current = draft.criteria?.[criteriaKey];
    ui.openPrompt(
      valuePrompt(
        current,
        step === 'yes' ? 'Yes means' : 'No means',
        presentation,
        (value) => {
          const criteria = { ...(draft.criteria ?? {}) };
          if (typeof value === 'string' && value.trim().length === 0) delete criteria[criteriaKey];
          else criteria[criteriaKey] = value;
          const updated: NoulQuestion =
            Object.keys(criteria).length > 0
              ? { type: 'noul', instructions: draft.instructions, criteria }
              : { type: 'noul', instructions: draft.instructions };
          advance(updated);
        },
        cancel,
      ),
    );
    return;
  }

  if (step === 'options') {
    if (draft.type !== 'choice') return;
    ui.openPrompt({
      kind: 'lines',
      label: 'Options (key: description)',
      initial: choiceToLines(draft),
      ...presentation,
      validate: (lines) => {
        const result = linesToChoice(lines, draft);
        return result.ok ? undefined : result.message;
      },
      onSubmit: (lines) => {
        const result = linesToChoice(lines, draft);
        if (result.ok) advance({ ...draft, criteria: result.criteria });
      },
      onCancel: cancel,
    });
    return;
  }

  if (step === 'levels') {
    if (draft.type !== 'score') return;
    ui.openPrompt({
      kind: 'lines',
      label: 'Levels',
      initial: scoreToLines(draft),
      ...presentation,
      validate: (lines) => {
        const result = linesToScore(lines, draft);
        return result.ok ? undefined : result.message;
      },
      onSubmit: (lines) => {
        const result = linesToScore(lines, draft);
        if (result.ok) advance({ ...draft, criteria: result.criteria });
      },
      onCancel: cancel,
    });
  }
}

export function beginQuestionEdit(
  ui: QuestionEditorUi,
  id: string,
  question: Question,
  options: QuestionEditOptions = {},
): void {
  runEditStep(ui, id, question, buildEditSteps(question), 0, options);
}

export function useQuestionEditor(
  ui: QuestionEditorUi,
): (id: string, question: Question, options?: QuestionEditOptions) => void {
  return (id, question, options) => beginQuestionEdit(ui, id, question, options);
}
