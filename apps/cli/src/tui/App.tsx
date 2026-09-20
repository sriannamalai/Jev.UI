// The TUI's app frame: three panes (wide) or a tab strip + one pane
// (narrow), focus, selection, and run (spec §8.2). Editing keys are the next
// task's job — `handleKey`/`KEYMAP` in `keys.ts` are the seam for them.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import {
  JevError,
  initialWorkbench,
  questionIds,
  requestToRun,
  workbenchReducer,
} from '@jev-ui/core';
import type {
  HistoryStore,
  Request,
  SetsStore,
  listModels as _listModels,
  run as _run,
} from '@jev-ui/core';
import { ResultsView } from './Results.js';
import { StatusLine } from './StatusLine.js';
import { Frame, QuestionsView, StateView } from './Panes.js';
import { KEYMAP, PANES, handleKey } from './keys.js';
import type { Pane } from './keys.js';
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

function nowIso(): string {
  return new Date().toISOString();
}

export function App(props: { deps: TuiDeps; initial?: Request }): ReactElement {
  const { deps, initial } = props;
  const [state, dispatch] = useReducer(workbenchReducer, initial, initialWorkbench);
  const { columns } = useTerminalSize({ columns: deps.columns });
  const { exit } = useApp();
  const [focused, setFocused] = useState<Pane>('state');
  const [helpVisible, setHelpVisible] = useState(false);
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

  useInput((input, key) => {
    handleKey(input, key, {
      focused,
      setFocused,
      helpVisible,
      setHelpVisible,
      questionIds: questionIds(state.request),
      selectedId: state.selectedId,
      select: (id) => dispatch({ type: 'select', id }),
      runRequested,
      exit,
    });
  });

  const wide = columns >= WIDE_MIN_COLUMNS;
  const stateWidth = wide ? Math.floor(columns * STATE_FRACTION) : columns;
  const questionsWidth = wide ? Math.floor(columns * QUESTIONS_FRACTION) : columns;
  const resultsWidth = wide ? columns - stateWidth - questionsWidth : columns;

  const errorLine = state.error
    ? `✕ ${state.error.kind}: ${state.error.message}${
        state.error.path ? ` at ${state.error.path}` : ''
      }`
    : notice;

  return (
    <Box flexDirection="column" width={columns}>
      {helpVisible ? (
        <HelpOverlay />
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
      {errorLine && <Text color={color ? 'red' : undefined}>{errorLine}</Text>}
      <StatusLine result={state.result} keyConfigured={deps.keyConfigured} />
      <Text dimColor={color}>Tab panes · ↑↓ select · r run · ? help · q quit</Text>
    </Box>
  );
}
