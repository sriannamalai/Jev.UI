// Web-specific layer over the shared, pure `workbenchReducer`. Adds the
// Form <-> JSON two-way sync (spec §8.1): editing the form re-serialises the
// JSON pane; editing JSON parses + validates on every change and only
// updates the form when the result is valid; while the JSON pane has focus
// it is never re-serialised underneath the user.
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  canRun,
  initialWorkbench,
  parseRequestJson,
  requestToRun,
  serializeRequest,
  setFromRequest,
  workbenchReducer,
  type QuestionSet,
  type Request,
  type WorkbenchAction,
  type WorkbenchState,
} from '@jev-ui/core/browser';
import { api as defaultApi, ApiError } from './api.js';

export type Mode = 'form' | 'split' | 'json';

export interface WebState {
  wb: WorkbenchState;
  mode: Mode;
  jsonText: string;
  jsonError: { message: string; line?: number } | undefined;
  jsonFocused: boolean;
}

export type WebAction =
  | { type: 'wb'; action: WorkbenchAction }
  | { type: 'setMode'; mode: Mode }
  | { type: 'jsonEdited'; text: string }
  | { type: 'jsonFocus'; focused: boolean };

const MODE_KEY = 'jev-ui.mode';

function isMode(value: string | null): value is Mode {
  return value === 'form' || value === 'split' || value === 'json';
}

function readMode(): Mode {
  try {
    const value = localStorage.getItem(MODE_KEY);
    if (isMode(value)) return value;
  } catch {
    // localStorage unavailable (private browsing, disabled, etc.) — fall
    // through to the default below.
  }
  return 'split';
}

export function initialWeb(request?: Request): WebState {
  const wb = initialWorkbench(request);
  return {
    wb,
    mode: readMode(),
    jsonText: serializeRequest(wb.request),
    jsonError: undefined,
    jsonFocused: false,
  };
}

export function webReducer(s: WebState, a: WebAction): WebState {
  switch (a.type) {
    case 'wb': {
      const next = workbenchReducer(s.wb, a.action);
      if (next === s.wb) return s;
      if (!s.jsonFocused && next.request !== s.wb.request) {
        return { ...s, wb: next, jsonText: serializeRequest(next.request), jsonError: undefined };
      }
      return { ...s, wb: next };
    }

    case 'setMode': {
      if (s.mode === a.mode) return s;
      return { ...s, mode: a.mode };
    }

    case 'jsonEdited': {
      const parsed = parseRequestJson(a.text);
      if (parsed.ok) {
        const wb = workbenchReducer(s.wb, { type: 'replaceRequest', request: parsed.request });
        return { ...s, wb, jsonText: a.text, jsonError: undefined };
      }
      const message =
        parsed.path === undefined ? parsed.message : `${parsed.path}: ${parsed.message}`;
      return { ...s, jsonText: a.text, jsonError: { message, line: parsed.line } };
    }

    case 'jsonFocus': {
      if (a.focused) return { ...s, jsonFocused: true };
      if (s.jsonError === undefined) {
        return { ...s, jsonFocused: false, jsonText: serializeRequest(s.wb.request) };
      }
      return { ...s, jsonFocused: false };
    }

    default: {
      const exhaustive: never = a;
      return exhaustive;
    }
  }
}

export function selectCanRun(s: WebState): boolean {
  return s.jsonError === undefined && canRun(s.wb);
}

type Api = typeof defaultApi;

interface WorkbenchContextValue {
  state: WebState;
  dispatch: Dispatch<WebAction>;
  run(): Promise<void>;
  save(name: string): Promise<void>;
  load(name: string): Promise<void>;
}

const WorkbenchContext = createContext<WorkbenchContextValue | undefined>(undefined);

export function WorkbenchProvider(props: { children: ReactNode; initial?: Request; api?: Api }) {
  const api = props.api ?? defaultApi;
  const [state, dispatch] = useReducer(webReducer, props.initial, initialWeb);

  // Kept in sync on every render so `run()` can make a synchronous,
  // up-to-the-instant decision (e.g. refusing a second concurrent call)
  // without waiting for React to commit and re-render.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, state.mode);
    } catch {
      // Persistence is best-effort; a full/blocked localStorage must not
      // crash the app.
    }
  }, [state.mode]);

  async function run(): Promise<void> {
    const before = stateRef.current;
    if (!selectCanRun(before)) return;

    const afterStart = webReducer(before, { type: 'wb', action: { type: 'runStart' } });
    if (afterStart === before) return;

    // Update the ref immediately (before any await or re-render) so a
    // synchronous second `run()` call sees `running: true` and refuses.
    stateRef.current = afterStart;
    dispatch({ type: 'wb', action: { type: 'runStart' } });

    const toSend = requestToRun(afterStart.wb);
    const setName = afterStart.wb.setName;

    try {
      const result = await api.run(toSend, setName);
      dispatch({ type: 'wb', action: { type: 'runOk', result } });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const error =
        err instanceof ApiError
          ? { kind: err.kind, message: err.message, path: err.path }
          : {
              kind: 'unexpected' as const,
              message: err instanceof Error ? err.message : String(err),
            };
      dispatch({ type: 'wb', action: { type: 'runFail', error } });
    }
  }

  async function save(name: string): Promise<void> {
    const { wb } = stateRef.current;
    await api.putSet(name, setFromRequest(name, wb.request));
    dispatch({ type: 'wb', action: { type: 'saved', name } });
  }

  async function load(name: string): Promise<void> {
    const set: QuestionSet = await api.getSet(name);
    dispatch({ type: 'wb', action: { type: 'loadSet', set } });
  }

  const value: WorkbenchContextValue = { state, dispatch, run, save, load };

  return <WorkbenchContext.Provider value={value}>{props.children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const ctx = useContext(WorkbenchContext);
  if (ctx === undefined) {
    throw new Error('useWorkbench must be used within a WorkbenchProvider');
  }
  return ctx;
}
