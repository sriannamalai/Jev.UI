// The TUI's app frame: three panes (wide) or a tab strip + one pane
// (narrow), focus, selection, run, the editing keys and the quit
// confirmation (spec §8.2). The per-type question edit steps live in
// QuestionEditor.tsx; the sets/export/$EDITOR flows in flows.ts.
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
  runBlockers,
  workbenchReducer,
} from '@jev-ui/core';
import type { Request, Text as JevText } from '@jev-ui/core';
import { ResultsView } from './Results.js';
import { StatusLine } from './StatusLine.js';
import { Frame, QuestionsView, StateView } from './Panes.js';
import { displayWidth, padEndDisplay } from './bars.js';
import { KEYMAP, KEY_GROUPS, PANES, handleKey } from './keys.js';
import type { Mode, Pane } from './keys.js';
import { ChoicePrompt, LinesPrompt, ListPrompt, TextPrompt } from './Prompts.js';
import type { PromptSpec } from './Prompts.js';
import { editInEditorFlow, exportFlow, openSetFlow, saveFlow } from './flows.js';
import type { FlowUi, TuiDeps } from './flows.js';
import { useQuestionEditor } from './QuestionEditor.js';
import { useTerminalSize } from './useTerminalSize.js';

export type { TuiDeps } from './flows.js';

const WIDE_MIN_COLUMNS = 120;
const STATE_FRACTION = 0.3;
const QUESTIONS_FRACTION = 0.3;
const BORDER_WIDTH = 2;

const PANE_LABELS: Record<Pane, string> = {
  state: 'State',
  questions: 'Questions',
  results: 'Results',
};

function TabStrip(props: { focused: Pane }) {
  const { focused } = props;
  const text = PANES.map((pane) =>
    pane === focused ? `[${PANE_LABELS[pane]}]` : ` ${PANE_LABELS[pane]} `,
  ).join('  ');
  return <Text>{text}</Text>;
}

function groupLines(groups: { heading: string; keys: string[] }[]): string[] {
  const lines: string[] = [];
  for (const group of groups) {
    lines.push(group.heading);
    for (const key of group.keys) {
      lines.push(`  ${key}  —  ${KEYMAP[key] ?? ''}`);
    }
  }
  return lines;
}

// Two columns so every KEYMAP entry fits an 80x24 terminal: the flat list
// (title + 5 groups + 1 blank-ish line per key) runs past 24 rows in one
// column.
const HELP_LEFT_GROUPS = KEY_GROUPS.slice(0, 3);
const HELP_RIGHT_GROUPS = KEY_GROUPS.slice(3);

function HelpOverlay() {
  const leftLines = groupLines(HELP_LEFT_GROUPS);
  const rightLines = groupLines(HELP_RIGHT_GROUPS);
  const leftWidth = leftLines.reduce((max, line) => Math.max(max, displayWidth(line)), 0);
  const rowCount = Math.max(leftLines.length, rightLines.length);

  return (
    <Box flexDirection="column">
      <Text>Keys</Text>
      {Array.from({ length: rowCount }, (_, index) => {
        const left = leftLines[index] ?? '';
        const right = rightLines[index] ?? '';
        const line = right.length > 0 ? `${padEndDisplay(left, leftWidth)}  ${right}` : left;
        return <Text key={index}>{line}</Text>;
      })}
    </Box>
  );
}

function PromptView(props: {
  prompt: PromptSpec;
  color: boolean;
  width: number;
  /** What Ctrl+C does inside any prompt that doesn't override it: cancel the
   * prompt and start the quit flow. */
  onCtrlC: () => void;
}) {
  const { prompt, color, width } = props;
  const onCtrlC = prompt.onCtrlC ?? props.onCtrlC;
  if (prompt.kind === 'text') {
    return (
      <TextPrompt
        label={prompt.label}
        initial={prompt.initial}
        validate={prompt.validate}
        onSubmit={prompt.onSubmit}
        onCancel={prompt.onCancel}
        onCtrlC={onCtrlC}
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
        onCtrlC={onCtrlC}
        width={width}
        color={color}
      />
    );
  }
  if (prompt.kind === 'list') {
    return (
      <ListPrompt
        label={prompt.label}
        items={prompt.items}
        onPick={prompt.onPick}
        onCancel={prompt.onCancel}
        onCtrlC={onCtrlC}
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
      onCtrlC={onCtrlC}
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
  const { exit: appExit, suspendTerminal } = useApp();
  const [focused, setFocused] = useState<Pane>('state');
  const [mode, setMode] = useState<Mode>('normal');
  const [prompt, setPrompt] = useState<PromptSpec | undefined>(undefined);
  // Bumped on every openPrompt so sequential edit steps (which reuse the
  // same prompt `kind`, e.g. Instructions -> Yes means) force a remount
  // instead of React reusing the previous step's internal text/cursor state.
  const [promptSeq, setPromptSeq] = useState(0);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const mountedRef = useRef(false);
  // Guards o/s/e/E against overlapping: set for the whole lifetime of a
  // flow (from keypress to its final notice/dispatch or cancellation),
  // including any prompt it opens along the way.
  const busyRef = useRef(false);
  // Set while the quit confirmation is on screen. A side flow that comes back
  // from an await in the meantime must not push its own prompt over it — the
  // user's next `y` belongs to the quit question, not to the flow's.
  const quitPendingRef = useRef(false);

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
      if (!state.running) {
        const blocker = runBlockers(state.request)[0];
        setNotice(blocker?.message ?? 'Request is not valid — nothing to run');
      }
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

  const editQuestion = useQuestionEditor({ openPrompt, closePrompt, setNotice, dispatch });

  function editSelected(): void {
    if (!state.selectedId) return;
    const question = state.request.questions[state.selectedId];
    if (!question) return;
    editQuestion(state.selectedId, question);
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

  /** Every side flow (o/s/S/e/E) runs under one busy guard for its whole
   * lifetime — keypress to final notice, dispatch or cancellation — so two
   * of them can never interleave. */
  function runFlow(start: (ui: FlowUi) => void): void {
    if (busyRef.current) return;
    busyRef.current = true;
    const release = () => {
      busyRef.current = false;
    };
    start({
      openPrompt: (spec) => {
        // Abandon the flow rather than take the screen from a pending quit:
        // nothing is written and the busy guard is released.
        if (quitPendingRef.current) {
          release();
          return;
        }
        openPrompt(spec);
      },
      closePrompt,
      setNotice,
      dispatch,
      isMounted: () => mountedRef.current && !quitPendingRef.current,
      done: release,
    });
  }

  function openSet(): void {
    runFlow((ui) => openSetFlow(deps, state, ui));
  }

  function save(forcePrompt: boolean): void {
    runFlow((ui) => saveFlow(deps, state, ui, { forcePrompt }));
  }

  function exportRequest(): void {
    runFlow((ui) => exportFlow(deps, state, ui));
  }

  function editInEditor(): void {
    runFlow((ui) => editInEditorFlow(deps, state, ui, suspendTerminal));
  }

  function quitFlow(): void {
    if (!state.dirty) {
      appExit();
      return;
    }
    quitPendingRef.current = true;
    openPrompt({
      kind: 'choice',
      label: 'Quit without saving?',
      options: [
        { key: 'y', label: 'Yes' },
        { key: 'n', label: 'No' },
      ],
      onPick: (key) => {
        if (key === 'y') {
          appExit();
          return;
        }
        quitPendingRef.current = false;
        closePrompt();
      },
      onCancel: () => {
        quitPendingRef.current = false;
        closePrompt();
      },
      onCtrlC: appExit,
    });
  }

  /** Ctrl+C inside a prompt: cancel that prompt (exactly as Esc does, so any
   * flow it belongs to releases `busyRef`) and start the quit flow — clean
   * exits at once, dirty asks for confirmation. */
  function promptCtrlC(): void {
    prompt?.onCancel();
    quitFlow();
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
        exit: quitFlow,
        addQuestion,
        deleteQuestion,
        duplicateQuestion,
        moveQuestion,
        editSelected,
        renameSelected,
        editState,
        editModel,
        openSet,
        save,
        exportFlow: exportRequest,
        editInEditor,
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
        <PromptView
          key={promptSeq}
          prompt={prompt}
          color={color}
          width={columns}
          onCtrlC={promptCtrlC}
        />
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
        Tab panes · ↑↓ select · r run · a add · o open · s save · e export · ? help · q quit
      </Text>
    </Box>
  );
}
