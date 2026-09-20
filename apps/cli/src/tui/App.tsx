// The TUI's app frame: three panes (wide) or a tab strip + one pane
// (narrow), focus, selection, run, the editing keys, sets, export,
// `$EDITOR`, and quit confirmation (spec §8.2).
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import {
  DEFAULT_MODEL,
  JevError,
  SET_NAME_RE,
  isValidQuestionId,
  initialWorkbench,
  exportRequest,
  parseRequestJson,
  questionIds,
  requestToRun,
  serializeRequest,
  setFromRequest,
  workbenchReducer,
} from '@jev-ui/core';
import type {
  ExportTarget,
  HistoryStore,
  NoulQuestion,
  Question,
  Request,
  SetsStore,
  SetSummary,
  Text as JevText,
  listModels as _listModels,
  run as _run,
} from '@jev-ui/core';
import { ResultsView } from './Results.js';
import { StatusLine } from './StatusLine.js';
import { Frame, QuestionsView, StateView } from './Panes.js';
import { displayWidth, padEndDisplay } from './bars.js';
import { KEYMAP, KEY_GROUPS, PANES, handleKey } from './keys.js';
import type { Mode, Pane } from './keys.js';
import { ChoicePrompt, LinesPrompt, ListPrompt, TextPrompt } from './Prompts.js';
import type { ListItem } from './Prompts.js';
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

const SAVE_NAME_HINT = 'Use lowercase letters, digits, - or _ (must start with a letter or digit)';

const EXPORT_OPTIONS: { key: string; label: string; target: ExportTarget; ext: string }[] = [
  { key: 'c', label: 'cURL', target: 'curl', ext: 'sh' },
  { key: 'p', label: 'Python', target: 'python', ext: 'py' },
  { key: 't', label: 'TypeScript', target: 'typescript', ext: 'ts' },
];

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface TuiDeps {
  run: typeof _run;
  sets: SetsStore;
  history: HistoryStore;
  keyConfigured: boolean;
  listModels: typeof _listModels;
  openEditor(text: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  cwd(): string;
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
      onCtrlC?: () => void;
    }
  | {
      kind: 'list';
      label: string;
      items: ListItem[];
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
  if (prompt.kind === 'list') {
    return (
      <ListPrompt
        label={prompt.label}
        items={prompt.items}
        onPick={prompt.onPick}
        onCancel={prompt.onCancel}
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
      onCtrlC={prompt.onCtrlC}
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

  function openSet(): void {
    if (busyRef.current) return;
    busyRef.current = true;
    const done = () => {
      busyRef.current = false;
    };

    const proceed = () => {
      void (async () => {
        try {
          const summaries = await deps.sets.list();
          if (!mountedRef.current) return;
          if (summaries.length === 0) {
            setNotice(`No sets in ${deps.sets.dir}`);
            done();
            return;
          }
          openPrompt({
            kind: 'list',
            label: 'Open set',
            items: summaries.map((summary: SetSummary) => ({
              key: summary.name,
              label: summary.valid
                ? `${summary.name}  (${summary.questionCount} question${
                    summary.questionCount === 1 ? '' : 's'
                  })`
                : `${summary.name}  — ${summary.error ?? 'invalid'}`,
              disabled: !summary.valid,
            })),
            onPick: (name) => {
              closePrompt();
              void (async () => {
                try {
                  const set = await deps.sets.load(name);
                  if (mountedRef.current) dispatch({ type: 'loadSet', set });
                } catch (err) {
                  if (mountedRef.current) setNotice(`✕ ${errMessage(err)}`);
                } finally {
                  done();
                }
              })();
            },
            onCancel: () => {
              closePrompt();
              done();
            },
          });
        } catch (err) {
          if (mountedRef.current) setNotice(`✕ ${errMessage(err)}`);
          done();
        }
      })();
    };

    if (state.dirty) {
      openPrompt({
        kind: 'choice',
        label: 'Discard unsaved changes?',
        options: [
          { key: 'y', label: 'Yes' },
          { key: 'n', label: 'No' },
        ],
        onPick: (key) => {
          closePrompt();
          if (key === 'y') proceed();
          else done();
        },
        onCancel: () => {
          closePrompt();
          done();
        },
      });
      return;
    }
    proceed();
  }

  function save(forcePrompt: boolean): void {
    if (busyRef.current) return;
    busyRef.current = true;
    const done = () => {
      busyRef.current = false;
    };

    const doSave = (name: string) => {
      void (async () => {
        try {
          await deps.sets.save(name, setFromRequest(name, state.request));
          if (mountedRef.current) {
            dispatch({ type: 'saved', name });
            setNotice(`Saved ${name}`);
          }
        } catch (err) {
          if (mountedRef.current) setNotice(`✕ ${errMessage(err)}`);
        } finally {
          done();
        }
      })();
    };

    if (!forcePrompt && state.setName) {
      doSave(state.setName);
      return;
    }

    openPrompt({
      kind: 'text',
      label: 'Save as',
      initial: state.setName ?? '',
      validate: (value) => (SET_NAME_RE.test(value.trim()) ? undefined : SAVE_NAME_HINT),
      onSubmit: (value) => {
        closePrompt();
        doSave(value.trim());
      },
      onCancel: () => {
        closePrompt();
        done();
      },
    });
  }

  function exportFlow(): void {
    if (busyRef.current) return;
    busyRef.current = true;
    const done = () => {
      busyRef.current = false;
    };

    openPrompt({
      kind: 'choice',
      label: 'Export as',
      options: EXPORT_OPTIONS.map((option) => ({ key: option.key, label: option.label })),
      onPick: (key) => {
        closePrompt();
        const option = EXPORT_OPTIONS.find((o) => o.key === key);
        if (!option) {
          done();
          return;
        }
        const fileName = `${state.setName ?? 'request'}.${option.ext}`;
        const filePath = `${deps.cwd()}/${fileName}`;

        const write = () => {
          void (async () => {
            try {
              const content = exportRequest(option.target, state.request);
              await deps.writeFile(filePath, content);
              if (mountedRef.current) setNotice(`Wrote ${fileName}`);
            } catch (err) {
              if (mountedRef.current) setNotice(`✕ ${errMessage(err)}`);
            } finally {
              done();
            }
          })();
        };

        void (async () => {
          try {
            const exists = await deps.fileExists(filePath);
            if (!mountedRef.current) {
              done();
              return;
            }
            if (exists) {
              openPrompt({
                kind: 'choice',
                label: `Overwrite ${fileName}?`,
                options: [
                  { key: 'y', label: 'Yes' },
                  { key: 'n', label: 'No' },
                ],
                onPick: (overwriteKey) => {
                  closePrompt();
                  if (overwriteKey === 'y') write();
                  else done();
                },
                onCancel: () => {
                  closePrompt();
                  done();
                },
              });
            } else {
              write();
            }
          } catch (err) {
            if (mountedRef.current) setNotice(`✕ ${errMessage(err)}`);
            done();
          }
        })();
      },
      onCancel: () => {
        closePrompt();
        done();
      },
    });
  }

  function editInEditor(): void {
    if (busyRef.current) return;
    busyRef.current = true;
    const done = () => {
      busyRef.current = false;
    };

    const text = serializeRequest(state.request);
    let result = text;
    void (async () => {
      try {
        await suspendTerminal(async () => {
          result = await deps.openEditor(text);
        });
        if (!mountedRef.current) {
          done();
          return;
        }
        if (result === text) {
          setNotice('No changes');
          done();
          return;
        }
        const parsed = parseRequestJson(result);
        if (!parsed.ok) {
          const location = parsed.line !== undefined ? `line ${parsed.line}: ` : '';
          setNotice(`✕ ${location}${parsed.message}`);
          done();
          return;
        }
        dispatch({ type: 'replaceRequest', request: parsed.request });
        setNotice('Request updated');
      } catch (err) {
        if (mountedRef.current) setNotice(`✕ ${errMessage(err)}`);
      } finally {
        done();
      }
    })();
  }

  function quitFlow(): void {
    if (!state.dirty) {
      appExit();
      return;
    }
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
        closePrompt();
      },
      onCancel: closePrompt,
      onCtrlC: appExit,
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
        exportFlow,
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
        Tab panes · ↑↓ select · r run · a add · o open · s save · e export · ? help · q quit
      </Text>
    </Box>
  );
}
