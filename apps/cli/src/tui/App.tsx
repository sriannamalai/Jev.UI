// The TUI's app frame: three panes (wide) or a tab strip + one pane
// (narrow), focus, selection, run, and the editing keys (spec §8.2). Sets,
// export, `$EDITOR` and quit-confirm are the next task's job.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import {
  DEFAULT_MODEL,
  JevError,
  isValidQuestionId,
  initialWorkbench,
  questionIds,
  requestToRun,
  workbenchReducer,
} from '@jev-ui/core';
import type {
  HistoryStore,
  NoulQuestion,
  Question,
  Request,
  SetsStore,
  Text as JevText,
  listModels as _listModels,
  run as _run,
} from '@jev-ui/core';
import { ResultsView } from './Results.js';
import { StatusLine } from './StatusLine.js';
import { Frame, QuestionsView, StateView } from './Panes.js';
import { KEYMAP, PANES, handleKey } from './keys.js';
import type { Mode, Pane } from './keys.js';
import { ChoicePrompt, LinesPrompt, TextPrompt } from './Prompts.js';
import {
  choiceToLines,
  editableText,
  linesToChoice,
  linesToScore,
  scoreToLines,
} from './questionEdit.js';
import { useTerminalSize } from './useTerminalSize.js';

const WIDE_MIN_COLUMNS = 120;
const STATE_FRACTION = 0.3;
const QUESTIONS_FRACTION = 0.3;
const BORDER_WIDTH = 2;

export interface TuiDeps {
  run: typeof _run;
  sets: SetsStore;
  history: HistoryStore;
  keyConfigured: boolean;
  listModels: typeof _listModels;
  openEditor(text: string): Promise<string>;
  columns?: number;
  env?: NodeJS.ProcessEnv;
}

const PANE_LABELS: Record<Pane, string> = {
  state: 'State',
  questions: 'Questions',
  results: 'Results',
};

type PromptSpec =
  | {
      kind: 'text';
      label: string;
      initial: string;
      validate?: (value: string) => string | undefined;
      onSubmit: (value: string) => void;
      onCancel: () => void;
    }
  | {
      kind: 'lines';
      label: string;
      initial: string[];
      validate?: (lines: string[]) => string | undefined;
      hint?: string;
      onSubmit: (lines: string[]) => void;
      onCancel: () => void;
    }
  | {
      kind: 'choice';
      label: string;
      options: { key: string; label: string }[];
      onPick: (key: string) => void;
      onCancel: () => void;
    };

type NoulEditStep = 'instructions' | 'yes' | 'no';
type ChoiceEditStep = 'instructions' | 'options';
type ScoreEditStep = 'instructions' | 'levels';
type EditStep = NoulEditStep | ChoiceEditStep | ScoreEditStep;

function buildEditSteps(question: Question): EditStep[] {
  switch (question.type) {
    case 'noul':
      return ['instructions', 'yes', 'no'];
    case 'choice':
      return ['instructions', 'options'];
    case 'score':
      return ['instructions', 'levels'];
  }
}

function TabStrip(props: { focused: Pane }) {
  const { focused } = props;
  const text = PANES.map((pane) =>
    pane === focused ? `[${PANE_LABELS[pane]}]` : ` ${PANE_LABELS[pane]} `,
  ).join('  ');
  return <Text>{text}</Text>;
}

function HelpOverlay() {
  return (
    <Box flexDirection="column">
      <Text>Keys</Text>
      {Object.entries(KEYMAP).map(([key, description]) => (
        <Text key={key}>
          {key}
          {'  —  '}
          {description}
        </Text>
      ))}
    </Box>
  );
}

function PromptView(props: { prompt: PromptSpec; color: boolean; width: number }) {
  const { prompt, color, width } = props;
  if (prompt.kind === 'text') {
    return (
      <TextPrompt
        label={prompt.label}
        initial={prompt.initial}
        validate={prompt.validate}
        onSubmit={prompt.onSubmit}
        onCancel={prompt.onCancel}
        width={width}
        color={color}
      />
    );
  }
  if (prompt.kind === 'lines') {
    return (
      <LinesPrompt
        label={prompt.label}
        initial={prompt.initial}
        validate={prompt.validate}
        hint={prompt.hint}
        onSubmit={prompt.onSubmit}
        onCancel={prompt.onCancel}
        width={width}
        color={color}
      />
    );
  }
  return (
    <ChoicePrompt
      label={prompt.label}
      options={prompt.options}
      onPick={prompt.onPick}
      onCancel={prompt.onCancel}
    />
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

export function App(props: { deps: TuiDeps; initial?: Request }): ReactElement {
  const { deps, initial } = props;
  const [state, dispatch] = useReducer(workbenchReducer, initial, initialWorkbench);
  const { columns } = useTerminalSize({ columns: deps.columns });
  const { exit } = useApp();
  const [focused, setFocused] = useState<Pane>('state');
  const [mode, setMode] = useState<Mode>('normal');
  const [prompt, setPrompt] = useState<PromptSpec | undefined>(undefined);
  // Bumped on every openPrompt so sequential edit steps (which reuse the
  // same prompt `kind`, e.g. Instructions -> Yes means) force a remount
  // instead of React reusing the previous step's internal text/cursor state.
  const [promptSeq, setPromptSeq] = useState(0);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const env = deps.env ?? process.env;
  const color = !('NO_COLOR' in env);

  const openPrompt = useCallback((spec: PromptSpec) => {
    setPrompt(spec);
    setPromptSeq((n) => n + 1);
    setMode('prompt');
  }, []);

  const closePrompt = useCallback(() => {
    setPrompt(undefined);
    setMode('normal');
  }, []);

  const runRequested = useCallback(() => {
    if (!deps.keyConfigured) return;

    const next = workbenchReducer(state, { type: 'runStart' });
    if (next === state) {
      if (!state.running) setNotice('Request is not valid — nothing to run');
      return;
    }

    setNotice(undefined);
    dispatch({ type: 'runStart' });
    const request = requestToRun(next);

    void (async () => {
      try {
        const result = await deps.run(request);
        if (mountedRef.current) dispatch({ type: 'runOk', result });
        try {
          await deps.history.append({ ts: nowIso(), request, result });
        } catch {
          // History is best-effort and must never surface to the UI.
        }
      } catch (err) {
        const error =
          err instanceof JevError
            ? { kind: err.kind, message: err.message, path: err.path }
            : {
                kind: 'unexpected' as const,
                message: err instanceof Error ? err.message : String(err),
              };
        if (mountedRef.current) dispatch({ type: 'runFail', error });
        try {
          await deps.history.append({ ts: nowIso(), request, error });
        } catch {
          // History is best-effort and must never surface to the UI.
        }
      }
    })();
  }, [deps, state]);

  function runEditStep(id: string, draft: Question, steps: EditStep[], index: number): void {
    if (index >= steps.length) {
      closePrompt();
      return;
    }
    const step = steps[index]!;

    const commit = (updated: Question) => {
      dispatch({ type: 'updateQuestion', id, question: updated });
      runEditStep(id, updated, steps, index + 1);
    };

    if (step === 'instructions') {
      const et = editableText(draft.instructions);
      if (!et.editable) {
        setNotice('Instructions are structured — press E to edit as JSON');
        runEditStep(id, draft, steps, index + 1);
        return;
      }
      openPrompt({
        kind: 'text',
        label: 'Instructions',
        initial: et.text,
        onSubmit: (text) => commit({ ...draft, instructions: text }),
        onCancel: closePrompt,
      });
      return;
    }

    if (step === 'yes' || step === 'no') {
      if (draft.type !== 'noul') {
        runEditStep(id, draft, steps, index + 1);
        return;
      }
      const criteriaKey = step === 'yes' ? ('true' as const) : ('false' as const);
      const current = draft.criteria?.[criteriaKey];
      const et = editableText(current);
      openPrompt({
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
        onCancel: closePrompt,
      });
      return;
    }

    if (step === 'options') {
      if (draft.type !== 'choice') {
        runEditStep(id, draft, steps, index + 1);
        return;
      }
      openPrompt({
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
        onCancel: closePrompt,
      });
      return;
    }

    if (step === 'levels') {
      if (draft.type !== 'score') {
        runEditStep(id, draft, steps, index + 1);
        return;
      }
      openPrompt({
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
        onCancel: closePrompt,
      });
    }
  }

  function editSelected(): void {
    if (!state.selectedId) return;
    const question = state.request.questions[state.selectedId];
    if (!question) return;
    runEditStep(state.selectedId, question, buildEditSteps(question), 0);
  }

  function addQuestion(): void {
    openPrompt({
      kind: 'choice',
      label: 'Add question — n noul / c choice / s score',
      options: [
        { key: 'n', label: 'Noul' },
        { key: 'c', label: 'Choice' },
        { key: 's', label: 'Score' },
      ],
      onPick: (pickedKey) => {
        const questionType = pickedKey === 'n' ? 'noul' : pickedKey === 'c' ? 'choice' : 'score';
        closePrompt();
        dispatch({ type: 'addQuestion', questionType });
        setFocused('questions');
      },
      onCancel: closePrompt,
    });
  }

  function deleteQuestion(): void {
    if (!state.selectedId) return;
    if (questionIds(state.request).length <= 1) {
      setNotice('A request needs at least one question');
      return;
    }
    dispatch({ type: 'deleteQuestion', id: state.selectedId });
  }

  function duplicateQuestion(): void {
    if (!state.selectedId) return;
    dispatch({ type: 'duplicateQuestion', id: state.selectedId });
  }

  function moveQuestion(delta: -1 | 1): void {
    if (!state.selectedId) return;
    dispatch({ type: 'moveQuestion', id: state.selectedId, delta });
  }

  function renameSelected(): void {
    if (!state.selectedId) return;
    const id = state.selectedId;
    openPrompt({
      kind: 'text',
      label: 'Rename question',
      initial: id,
      validate: (value) => {
        const trimmed = value.trim();
        if (!isValidQuestionId(trimmed)) {
          return 'Use letters, digits, _ or - (must start with a letter or _)';
        }
        if (trimmed !== id && Object.hasOwn(state.request.questions, trimmed)) {
          return 'A question with this id already exists';
        }
        return undefined;
      },
      onSubmit: (value) => {
        closePrompt();
        dispatch({ type: 'renameQuestion', id, newId: value.trim() });
      },
      onCancel: closePrompt,
    });
  }

  function editState(): void {
    const value = state.request.state;
    if (typeof value !== 'string' || value.includes('\n')) {
      setNotice('State is multi-line or structured — press E to edit it in your editor');
      return;
    }
    openPrompt({
      kind: 'text',
      label: 'State',
      initial: value,
      onSubmit: (text) => {
        closePrompt();
        let next: JevText = text;
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed !== null && typeof parsed === 'object') next = parsed as JevText;
        } catch {
          // Not JSON — keep as a plain string.
        }
        dispatch({ type: 'setState', state: next });
      },
      onCancel: closePrompt,
    });
  }

  function editModel(): void {
    openPrompt({
      kind: 'text',
      label: 'Model',
      initial: state.request.model ?? DEFAULT_MODEL,
      validate: (value) => (value.trim().length === 0 ? 'Model cannot be empty' : undefined),
      onSubmit: (value) => {
        closePrompt();
        dispatch({ type: 'setModel', model: value.trim() });
      },
      onCancel: closePrompt,
    });
  }

  useInput(
    (input, key) => {
      setNotice(undefined);
      handleKey(input, key, {
        focused,
        setFocused,
        mode,
        setMode,
        questionIds: questionIds(state.request),
        selectedId: state.selectedId,
        select: (id) => dispatch({ type: 'select', id }),
        runRequested,
        exit,
        addQuestion,
        deleteQuestion,
        duplicateQuestion,
        moveQuestion,
        editSelected,
        renameSelected,
        editState,
        editModel,
      });
    },
    { isActive: mode !== 'prompt' },
  );

  const wide = columns >= WIDE_MIN_COLUMNS;
  const stateWidth = wide ? Math.floor(columns * STATE_FRACTION) : columns;
  const questionsWidth = wide ? Math.floor(columns * QUESTIONS_FRACTION) : columns;
  const resultsWidth = wide ? columns - stateWidth - questionsWidth : columns;

  const isError = state.error !== undefined;
  const errorLine = isError
    ? `✕ ${state.error!.kind}: ${state.error!.message}${
        state.error!.path ? ` at ${state.error!.path}` : ''
      }`
    : notice;

  return (
    <Box flexDirection="column" width={columns}>
      {mode === 'help' ? (
        <HelpOverlay />
      ) : mode === 'prompt' && prompt ? (
        <PromptView key={promptSeq} prompt={prompt} color={color} width={columns} />
      ) : wide ? (
        <Box flexDirection="row">
          <Frame title="STATE" focused={focused === 'state'} width={stateWidth} color={color}>
            <StateView request={state.request} width={stateWidth - BORDER_WIDTH} />
          </Frame>
          <Frame
            title="QUESTIONS"
            focused={focused === 'questions'}
            width={questionsWidth}
            color={color}
          >
            <QuestionsView
              request={state.request}
              selectedId={state.selectedId}
              width={questionsWidth - BORDER_WIDTH}
              color={color}
            />
          </Frame>
          <Frame title="RESULTS" focused={focused === 'results'} width={resultsWidth} color={color}>
            <ResultsView
              request={state.request}
              result={state.result}
              stale={state.stale}
              running={state.running}
              selectedId={state.selectedId}
              width={resultsWidth - BORDER_WIDTH}
              color={color}
            />
          </Frame>
        </Box>
      ) : (
        <Box flexDirection="column">
          <TabStrip focused={focused} />
          {focused === 'state' && (
            <Frame title="STATE" focused width={columns} color={color}>
              <StateView request={state.request} width={columns - BORDER_WIDTH} />
            </Frame>
          )}
          {focused === 'questions' && (
            <Frame title="QUESTIONS" focused width={columns} color={color}>
              <QuestionsView
                request={state.request}
                selectedId={state.selectedId}
                width={columns - BORDER_WIDTH}
                color={color}
              />
            </Frame>
          )}
          {focused === 'results' && (
            <Frame title="RESULTS" focused width={columns} color={color}>
              <ResultsView
                request={state.request}
                result={state.result}
                stale={state.stale}
                running={state.running}
                selectedId={state.selectedId}
                width={columns - BORDER_WIDTH}
                color={color}
              />
            </Frame>
          )}
        </Box>
      )}
      {errorLine && <Text color={isError && color ? 'red' : undefined}>{errorLine}</Text>}
      <StatusLine result={state.result} keyConfigured={deps.keyConfigured} />
      <Text dimColor={color}>
        Tab panes · ↑↓ select · r run · a add · d/D del/dup · ? help · q quit
      </Text>
    </Box>
  );
}
