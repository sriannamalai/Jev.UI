// The TUI's asynchronous side flows (spec §8.2): open a saved set, save,
// export, and editing the whole request in `$EDITOR`. Plain functions taking
// `deps`, the current workbench state and a small bundle of UI callbacks, so
// `App.tsx` keeps only the frame, focus, selection and key routing.
import * as nodePath from 'node:path';
import {
  SET_NAME_RE,
  exportRequest,
  parseRequestJson,
  serializeRequest,
  setFromRequest,
  workbenchReducer,
} from '@jev-ui/core';
import type {
  ExportTarget,
  HistoryStore,
  SetsStore,
  SetSummary,
  listModels as _listModels,
  run as _run,
} from '@jev-ui/core';
import type { PromptSpec } from './Prompts.js';

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

type Workbench = Parameters<typeof workbenchReducer>[0];
type WorkbenchAction = Parameters<typeof workbenchReducer>[1];

/** What a flow is allowed to do to the UI. `done` releases the busy guard
 * App holds for the flow's whole lifetime (keypress to final notice or
 * cancellation), and `isMounted` guards every hop across an `await`. */
export interface FlowUi {
  openPrompt(spec: PromptSpec): void;
  closePrompt(): void;
  setNotice(text: string | undefined): void;
  dispatch(action: WorkbenchAction): void;
  isMounted(): boolean;
  done(): void;
}

export const SAVE_NAME_HINT =
  'Use lowercase letters, digits, - or _ (must start with a letter or digit)';

export const EXPORT_OPTIONS: { key: string; label: string; target: ExportTarget; ext: string }[] = [
  { key: 'c', label: 'cURL', target: 'curl', ext: 'sh' },
  { key: 'p', label: 'Python', target: 'python', ext: 'py' },
  { key: 't', label: 'TypeScript', target: 'typescript', ext: 'ts' },
];

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function openSetFlow(deps: TuiDeps, state: Workbench, ui: FlowUi): void {
  const proceed = () => {
    void (async () => {
      try {
        const summaries = await deps.sets.list();
        if (!ui.isMounted()) return;
        if (summaries.length === 0) {
          ui.setNotice(`No sets in ${deps.sets.dir}`);
          ui.done();
          return;
        }
        ui.openPrompt({
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
            ui.closePrompt();
            void (async () => {
              try {
                const set = await deps.sets.load(name);
                if (ui.isMounted()) ui.dispatch({ type: 'loadSet', set });
              } catch (err) {
                if (ui.isMounted()) ui.setNotice(`✕ ${errMessage(err)}`);
              } finally {
                ui.done();
              }
            })();
          },
          onCancel: () => {
            ui.closePrompt();
            ui.done();
          },
        });
      } catch (err) {
        if (ui.isMounted()) ui.setNotice(`✕ ${errMessage(err)}`);
        ui.done();
      }
    })();
  };

  if (state.dirty) {
    ui.openPrompt({
      kind: 'choice',
      label: 'Discard unsaved changes?',
      options: [
        { key: 'y', label: 'Yes' },
        { key: 'n', label: 'No' },
      ],
      onPick: (key) => {
        ui.closePrompt();
        if (key === 'y') proceed();
        else ui.done();
      },
      onCancel: () => {
        ui.closePrompt();
        ui.done();
      },
    });
    return;
  }
  proceed();
}

export function saveFlow(
  deps: TuiDeps,
  state: Workbench,
  ui: FlowUi,
  options: { forcePrompt: boolean },
): void {
  const doSave = (name: string) => {
    void (async () => {
      try {
        await deps.sets.save(name, setFromRequest(name, state.request));
        if (ui.isMounted()) {
          ui.dispatch({ type: 'saved', name });
          ui.setNotice(`Saved ${name}`);
        }
      } catch (err) {
        if (ui.isMounted()) ui.setNotice(`✕ ${errMessage(err)}`);
      } finally {
        ui.done();
      }
    })();
  };

  if (!options.forcePrompt && state.setName) {
    doSave(state.setName);
    return;
  }

  ui.openPrompt({
    kind: 'text',
    label: 'Save as',
    initial: state.setName ?? '',
    validate: (value) => (SET_NAME_RE.test(value.trim()) ? undefined : SAVE_NAME_HINT),
    onSubmit: (value) => {
      ui.closePrompt();
      doSave(value.trim());
    },
    onCancel: () => {
      ui.closePrompt();
      ui.done();
    },
  });
}

export function exportFlow(deps: TuiDeps, state: Workbench, ui: FlowUi): void {
  ui.openPrompt({
    kind: 'choice',
    label: 'Export as',
    options: EXPORT_OPTIONS.map((option) => ({ key: option.key, label: option.label })),
    onPick: (key) => {
      ui.closePrompt();
      const option = EXPORT_OPTIONS.find((o) => o.key === key);
      if (!option) {
        ui.done();
        return;
      }
      // `state.setName` is only ever a validated set name, but an export
      // writes into the user's working directory, so the base name is
      // re-checked here rather than trusted: anything else falls back to
      // "request", and the resolved path must still sit directly in cwd.
      const setName = state.setName ?? '';
      const baseName = SET_NAME_RE.test(setName) ? setName : 'request';
      const fileName = `${baseName}.${option.ext}`;
      const cwd = deps.cwd();
      const filePath = nodePath.join(cwd, fileName);
      const displayPath = `./${nodePath.relative(cwd, filePath)}`;
      if (nodePath.dirname(nodePath.resolve(filePath)) !== nodePath.resolve(cwd)) {
        ui.setNotice('✕ Refusing to write outside the working directory');
        ui.done();
        return;
      }

      const write = () => {
        void (async () => {
          try {
            const content = exportRequest(option.target, state.request);
            await deps.writeFile(filePath, content);
            if (ui.isMounted()) ui.setNotice(`Wrote ${displayPath}`);
          } catch (err) {
            if (ui.isMounted()) ui.setNotice(`✕ ${errMessage(err)}`);
          } finally {
            ui.done();
          }
        })();
      };

      void (async () => {
        try {
          const exists = await deps.fileExists(filePath);
          if (!ui.isMounted()) {
            ui.done();
            return;
          }
          if (exists) {
            ui.openPrompt({
              kind: 'choice',
              label: `Overwrite ${displayPath}?`,
              options: [
                { key: 'y', label: 'Yes' },
                { key: 'n', label: 'No' },
              ],
              onPick: (overwriteKey) => {
                ui.closePrompt();
                if (overwriteKey === 'y') write();
                else ui.done();
              },
              onCancel: () => {
                ui.closePrompt();
                ui.done();
              },
            });
          } else {
            write();
          }
        } catch (err) {
          if (ui.isMounted()) ui.setNotice(`✕ ${errMessage(err)}`);
          ui.done();
        }
      })();
    },
    onCancel: () => {
      ui.closePrompt();
      ui.done();
    },
  });
}

export function editInEditorFlow(
  deps: TuiDeps,
  state: Workbench,
  ui: FlowUi,
  suspendTerminal: (callback: () => Promise<void>) => Promise<void> | void,
): void {
  const text = serializeRequest(state.request);
  let result = text;
  void (async () => {
    try {
      await suspendTerminal(async () => {
        result = await deps.openEditor(text);
        // Keys typed while the editor was handing the terminal back stay in
        // the buffer and are replayed as commands. Ink owns stdin (it is not
        // exposed through `useApp`, and `deps` deliberately has no handle on
        // the real stream, so tests drive a fake one), so there is no safe
        // way to drain it from here — left as-is rather than reaching into
        // `process.stdin` behind Ink's back.
      });
      if (!ui.isMounted()) {
        ui.done();
        return;
      }
      if (result === text) {
        ui.setNotice('No changes');
        ui.done();
        return;
      }
      const parsed = parseRequestJson(result);
      if (!parsed.ok) {
        const location = parsed.line !== undefined ? `line ${parsed.line}: ` : '';
        ui.setNotice(`✕ ${location}${parsed.message}`);
        ui.done();
        return;
      }
      ui.dispatch({ type: 'replaceRequest', request: parsed.request });
      ui.setNotice('Request updated');
    } catch (err) {
      if (ui.isMounted()) ui.setNotice(`✕ ${errMessage(err)}`);
    } finally {
      ui.done();
    }
  })();
}
