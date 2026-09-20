// The Enter-to-edit step sequencer (spec §8.2): a question is edited as a
// short series of prompts (Instructions, then the type's own fields), each
// committed as it is submitted so the next step builds on the latest draft.
// Kept out of App.tsx, which only owns the frame, focus and key routing.
import type { NoulQuestion, Question, workbenchReducer } from '@jev-ui/core';
import type { PromptSpec } from './Prompts.js';
import {
  choiceToLines,
  editableText,
  linesToChoice,
  linesToScore,
  scoreToLines,
} from './questionEdit.js';

type WorkbenchAction = Parameters<typeof workbenchReducer>[1];

type NoulEditStep = 'instructions' | 'yes' | 'no';
type ChoiceEditStep = 'instructions' | 'options';
type ScoreEditStep = 'instructions' | 'levels';
type EditStep = NoulEditStep | ChoiceEditStep | ScoreEditStep;

export interface QuestionEditorUi {
  /** Opening a prompt also remounts it (App bumps its prompt key), which is
   * what lets two steps of the same `kind` — Instructions then Yes means —
   * start from their own text and cursor instead of the previous step's. */
  openPrompt(spec: PromptSpec): void;
  closePrompt(): void;
  setNotice(text: string | undefined): void;
  dispatch(action: WorkbenchAction): void;
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

function runEditStep(
  ui: QuestionEditorUi,
  id: string,
  draft: Question,
  steps: EditStep[],
  index: number,
): void {
  if (index >= steps.length) {
    ui.closePrompt();
    return;
  }
  const step = steps[index]!;

  const commit = (updated: Question) => {
    ui.dispatch({ type: 'updateQuestion', id, question: updated });
    runEditStep(ui, id, updated, steps, index + 1);
  };

  if (step === 'instructions') {
    const et = editableText(draft.instructions);
    if (!et.editable) {
      ui.setNotice('Instructions are structured — press E to edit as JSON');
      runEditStep(ui, id, draft, steps, index + 1);
      return;
    }
    ui.openPrompt({
      kind: 'text',
      label: 'Instructions',
      initial: et.text,
      onSubmit: (text) => commit({ ...draft, instructions: text }),
      onCancel: ui.closePrompt,
    });
    return;
  }

  if (step === 'yes' || step === 'no') {
    if (draft.type !== 'noul') {
      runEditStep(ui, id, draft, steps, index + 1);
      return;
    }
    const criteriaKey = step === 'yes' ? ('true' as const) : ('false' as const);
    const current = draft.criteria?.[criteriaKey];
    const et = editableText(current);
    ui.openPrompt({
      kind: 'text',
      label: step === 'yes' ? 'Yes means' : 'No means',
      initial: et.editable ? et.text : '',
      onSubmit: (text) => {
        const trimmed = text.trim();
        const criteria = { ...(draft.criteria ?? {}) };
        if (trimmed.length === 0) delete criteria[criteriaKey];
        else criteria[criteriaKey] = text;
        const updated: NoulQuestion =
          Object.keys(criteria).length > 0
            ? { type: 'noul', instructions: draft.instructions, criteria }
            : { type: 'noul', instructions: draft.instructions };
        commit(updated);
      },
      onCancel: ui.closePrompt,
    });
    return;
  }

  if (step === 'options') {
    if (draft.type !== 'choice') {
      runEditStep(ui, id, draft, steps, index + 1);
      return;
    }
    ui.openPrompt({
      kind: 'lines',
      label: 'Options (key: description)',
      initial: choiceToLines(draft),
      validate: (lines) => {
        const result = linesToChoice(lines, draft);
        return result.ok ? undefined : result.message;
      },
      onSubmit: (lines) => {
        const result = linesToChoice(lines, draft);
        if (!result.ok) return;
        commit({ ...draft, criteria: result.criteria });
      },
      onCancel: ui.closePrompt,
    });
    return;
  }

  if (step === 'levels') {
    if (draft.type !== 'score') {
      runEditStep(ui, id, draft, steps, index + 1);
      return;
    }
    ui.openPrompt({
      kind: 'lines',
      label: 'Levels',
      initial: scoreToLines(draft),
      validate: (lines) => {
        const result = linesToScore(lines, draft);
        return result.ok ? undefined : result.message;
      },
      onSubmit: (lines) => {
        const result = linesToScore(lines, draft);
        if (!result.ok) return;
        commit({ ...draft, criteria: result.criteria });
      },
      onCancel: ui.closePrompt,
    });
  }
}

/** Returns "edit this question": it walks the type's step list, committing
 * each step as it is submitted. */
export function useQuestionEditor(ui: QuestionEditorUi): (id: string, question: Question) => void {
  return (id, question) => runEditStep(ui, id, question, buildEditSteps(question), 0);
}
