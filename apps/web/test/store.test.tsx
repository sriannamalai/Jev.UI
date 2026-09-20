import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { QuestionSet, Request } from '@jev-ui/core/browser';
import { serializeRequest } from '@jev-ui/core/browser';
import { ApiError } from '../src/api.js';
import {
  WorkbenchProvider,
  initialWeb,
  selectCanRun,
  useWorkbench,
  webReducer,
  type WebState,
} from '../src/store.js';

const SAMPLE_REQUEST: Request = {
  state: 'the customer says the app crashed',
  questions: {
    crashed: { type: 'noul', instructions: 'did the app crash?' },
  },
};

const SAMPLE_SET: QuestionSet = {
  name: 'support-triage',
  questions: {
    crashed: { type: 'noul', instructions: 'did the app crash?' },
  },
};

function baseState(): WebState {
  return initialWeb(SAMPLE_REQUEST);
}

describe('initialWeb', () => {
  it('serialises the initial request into jsonText and defaults mode to split', () => {
    const s = baseState();
    expect(s.mode).toBe('split');
    expect(s.jsonText).toBe(serializeRequest(SAMPLE_REQUEST));
    expect(s.jsonError).toBeUndefined();
    expect(s.jsonFocused).toBe(false);
  });
});

describe('webReducer — wb actions (form edit re-serialises JSON)', () => {
  it('re-serialises jsonText when a form edit changes the request', () => {
    const s = baseState();
    const next = webReducer(s, { type: 'wb', action: { type: 'setModel', model: 'jev-pro' } });
    expect(next.wb.request.model).toBe('jev-pro');
    expect(next.jsonText).toBe(serializeRequest(next.wb.request));
    expect(next.jsonError).toBeUndefined();
  });

  it('returns the exact same state object for a no-op wb action', () => {
    const s = baseState();
    const next = webReducer(s, { type: 'wb', action: { type: 'select', id: s.wb.selectedId } });
    expect(next).toBe(s);
  });

  it('does not touch jsonText when only non-request fields change', () => {
    const s = baseState();
    const otherId = Object.keys(s.wb.request.questions).find((id) => id !== s.wb.selectedId);
    // select is a no-op if otherId is undefined; guard so the test is meaningful.
    expect(otherId).toBeUndefined(); // only one question in the sample request
    // Use `saved`, which changes wb but not wb.request, to exercise the "only
    // non-request fields changed" branch.
    const saved = webReducer(s, { type: 'wb', action: { type: 'saved', name: 'foo' } });
    expect(saved.wb.setName).toBe('foo');
    expect(saved.wb.request).toBe(s.wb.request);
    expect(saved.jsonText).toBe(s.jsonText);
  });

  it('does not re-serialise jsonText for a form edit while the JSON pane is focused', () => {
    const focused = { ...baseState(), jsonFocused: true };
    const next = webReducer(focused, {
      type: 'wb',
      action: { type: 'setModel', model: 'jev-pro' },
    });
    expect(next.wb.request.model).toBe('jev-pro');
    expect(next.jsonText).toBe(focused.jsonText);
  });
});

describe('webReducer — jsonEdited', () => {
  it('valid text updates wb.request and leaves jsonText byte-identical to what was typed', () => {
    const s = baseState();
    const edited: Request = { ...SAMPLE_REQUEST, model: 'jev-pro' };
    const text = JSON.stringify(edited, null, 4); // deliberately different formatting
    const next = webReducer(s, { type: 'jsonEdited', text });
    expect(next.wb.request.model).toBe('jev-pro');
    expect(next.jsonText).toBe(text);
    expect(next.jsonError).toBeUndefined();
  });

  it('invalid JSON keeps wb.request untouched and sets jsonError with a line', () => {
    const s = baseState();
    const text = '{ "state": "x", '; // truncated / malformed
    const next = webReducer(s, { type: 'jsonEdited', text });
    expect(next.wb.request).toBe(s.wb.request);
    expect(next.jsonText).toBe(text);
    expect(next.jsonError).toBeDefined();
    expect(typeof next.jsonError?.message).toBe('string');
  });

  it('JSON that parses but fails schema validation sets jsonError with the path in the message', () => {
    const s = baseState();
    const text = JSON.stringify({ state: '', model: 'x', questions: {} });
    const next = webReducer(s, { type: 'jsonEdited', text });
    expect(next.wb.request).toBe(s.wb.request);
    expect(next.jsonError).toBeDefined();
    expect(next.jsonError?.message).toMatch(/questions/);
  });
});

describe('webReducer — jsonFocus', () => {
  it('focused:true only sets the flag, leaving jsonText untouched', () => {
    const s = { ...baseState(), jsonText: 'stale-but-broken-text-kept-as-is' };
    const next = webReducer(s, { type: 'jsonFocus', focused: true });
    expect(next.jsonFocused).toBe(true);
    expect(next.jsonText).toBe(s.jsonText);
  });

  it('blur with no error re-serialises jsonText from wb.request', () => {
    const s = { ...baseState(), jsonFocused: true, jsonText: '{\n  "weird": "formatting"\n}' };
    const next = webReducer(s, { type: 'jsonFocus', focused: false });
    expect(next.jsonFocused).toBe(false);
    expect(next.jsonText).toBe(serializeRequest(s.wb.request));
  });

  it('blur with an error keeps the broken text', () => {
    const broken = webReducer(baseState(), { type: 'jsonEdited', text: '{ broken' });
    const focused = { ...broken, jsonFocused: true };
    const next = webReducer(focused, { type: 'jsonFocus', focused: false });
    expect(next.jsonFocused).toBe(false);
    expect(next.jsonError).toBeDefined();
    expect(next.jsonText).toBe('{ broken');
  });

  it('blur with syntactically valid JSON that fails schema validation keeps the text and the error', () => {
    const text = JSON.stringify({ state: '', model: 'x', questions: {} });
    const edited = webReducer(baseState(), { type: 'jsonEdited', text });
    expect(edited.jsonError).toBeDefined();

    const focused = { ...edited, jsonFocused: true };
    const next = webReducer(focused, { type: 'jsonFocus', focused: false });
    expect(next.jsonFocused).toBe(false);
    expect(next.jsonError).toBeDefined();
    expect(next.jsonText).toBe(text);
  });
});

describe('webReducer — setMode', () => {
  it('updates mode', () => {
    const s = baseState();
    const next = webReducer(s, { type: 'setMode', mode: 'json' });
    expect(next.mode).toBe('json');
  });

  it('returns the same state object when mode is unchanged', () => {
    const s = baseState();
    const next = webReducer(s, { type: 'setMode', mode: s.mode });
    expect(next).toBe(s);
  });
});

describe('selectCanRun', () => {
  it('is false when jsonError is set even if the workbench itself canRun', () => {
    const broken = webReducer(baseState(), { type: 'jsonEdited', text: '{ broken' });
    expect(selectCanRun(broken)).toBe(false);
  });

  it('is true when there is no jsonError and the workbench canRun', () => {
    expect(selectCanRun(baseState())).toBe(true);
  });

  it('is false when the workbench is running', () => {
    const s = baseState();
    const running = webReducer(s, { type: 'wb', action: { type: 'runStart' } });
    expect(selectCanRun(running)).toBe(false);
  });
});

// --- Provider / useWorkbench tests -----------------------------------------

interface FakeApi {
  run: ReturnType<typeof vi.fn>;
  putSet: ReturnType<typeof vi.fn>;
  getSet: ReturnType<typeof vi.fn>;
}

function makeFakeApi(overrides?: Partial<FakeApi>): FakeApi {
  return {
    run: vi.fn(),
    putSet: vi.fn(),
    getSet: vi.fn(),
    ...overrides,
  };
}

function wrapper(fakeApi: FakeApi) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <WorkbenchProvider api={fakeApi as never} initial={SAMPLE_REQUEST}>
        {children}
      </WorkbenchProvider>
    );
  };
}

describe('WorkbenchProvider / useWorkbench', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('throws a clear error when used outside a provider', () => {
    expect(() => renderHook(() => useWorkbench())).toThrow(/WorkbenchProvider/);
  });

  it('run() sends exactly the snapshot and renders into state.wb.result', async () => {
    const fakeApi = makeFakeApi({
      run: vi.fn().mockResolvedValue({ questions: {} }),
    });
    const { result } = renderHook(() => useWorkbench(), { wrapper: wrapper(fakeApi) });
    const snapshot = result.current.state.wb.request;

    await act(async () => {
      await result.current.run();
    });

    expect(fakeApi.run).toHaveBeenCalledTimes(1);
    expect(fakeApi.run).toHaveBeenCalledWith(snapshot, undefined, expect.any(AbortSignal));
    expect(result.current.state.wb.result).toEqual({ questions: {} });
    expect(result.current.state.wb.running).toBe(false);
  });

  it('aborts the in-flight run when the provider unmounts, without surfacing an error', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fakeApi = makeFakeApi({
      run: vi.fn(
        (_request: unknown, _setName: unknown, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            capturedSignal = signal;
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          }),
      ),
    });
    const { result, unmount } = renderHook(() => useWorkbench(), { wrapper: wrapper(fakeApi) });

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run();
    });

    await waitFor(() => expect(result.current.state.wb.running).toBe(true));
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
    await expect(runPromise).resolves.toBeUndefined();
  });

  it('an edit dispatched between runStart and resolution marks the result stale', async () => {
    let resolveRun: (value: { questions: Record<string, never> }) => void = () => {};
    const fakeApi = makeFakeApi({
      run: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveRun = resolve;
          }),
      ),
    });
    const { result } = renderHook(() => useWorkbench(), { wrapper: wrapper(fakeApi) });

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run();
    });

    await waitFor(() => expect(result.current.state.wb.running).toBe(true));

    act(() => {
      result.current.dispatch({ type: 'wb', action: { type: 'setModel', model: 'jev-pro' } });
    });

    await act(async () => {
      resolveRun({ questions: {} });
      await runPromise;
    });

    expect(result.current.state.wb.stale).toBe(true);
  });

  it('an ApiError with kind validation and a path lands in wb.error', async () => {
    const fakeApi = makeFakeApi({
      run: vi
        .fn()
        .mockRejectedValue(
          new ApiError('validation', 'bad question', { path: 'questions.crashed' }),
        ),
    });
    const { result } = renderHook(() => useWorkbench(), { wrapper: wrapper(fakeApi) });

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.state.wb.error).toEqual({
      kind: 'validation',
      message: 'bad question',
      path: 'questions.crashed',
    });
    expect(result.current.state.wb.running).toBe(false);
  });

  it('run() is a no-op when jsonError is set', async () => {
    const fakeApi = makeFakeApi({ run: vi.fn().mockResolvedValue({ questions: {} }) });
    const { result } = renderHook(() => useWorkbench(), { wrapper: wrapper(fakeApi) });

    act(() => {
      result.current.dispatch({ type: 'jsonEdited', text: '{ broken' });
    });
    expect(result.current.state.jsonError).toBeDefined();

    await act(async () => {
      await result.current.run();
    });

    expect(fakeApi.run).not.toHaveBeenCalled();
  });

  it('double run() calls api.run once', async () => {
    let resolveRun: (value: { questions: Record<string, never> }) => void = () => {};
    const fakeApi = makeFakeApi({
      run: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveRun = resolve;
          }),
      ),
    });
    const { result } = renderHook(() => useWorkbench(), { wrapper: wrapper(fakeApi) });

    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => {
      p1 = result.current.run();
      p2 = result.current.run();
    });

    await act(async () => {
      resolveRun({ questions: {} });
      await Promise.all([p1, p2]);
    });

    expect(fakeApi.run).toHaveBeenCalledTimes(1);
  });

  it('save() dispatches saved and rejects on failure', async () => {
    const fakeApi = makeFakeApi({ putSet: vi.fn().mockResolvedValue(undefined) });
    const { result } = renderHook(() => useWorkbench(), { wrapper: wrapper(fakeApi) });

    await act(async () => {
      await result.current.save('support-triage');
    });
    expect(fakeApi.putSet).toHaveBeenCalledWith(
      'support-triage',
      expect.objectContaining({ name: 'support-triage' }),
    );
    expect(result.current.state.wb.setName).toBe('support-triage');
    expect(result.current.state.wb.dirty).toBe(false);

    const failing = makeFakeApi({ putSet: vi.fn().mockRejectedValue(new Error('disk full')) });
    const { result: result2 } = renderHook(() => useWorkbench(), { wrapper: wrapper(failing) });
    await expect(result2.current.save('x')).rejects.toThrow('disk full');
    await expect(result2.current.save('x')).rejects.toBeInstanceOf(Error);
  });

  it('load() replaces the request and re-serialises jsonText', async () => {
    const fakeApi = makeFakeApi({ getSet: vi.fn().mockResolvedValue(SAMPLE_SET) });
    const { result } = renderHook(() => useWorkbench(), { wrapper: wrapper(fakeApi) });

    await act(async () => {
      await result.current.load('support-triage');
    });

    expect(result.current.state.wb.setName).toBe('support-triage');
    expect(result.current.state.jsonText).toBe(serializeRequest(result.current.state.wb.request));
  });

  it('load() rejects on failure', async () => {
    const fakeApi = makeFakeApi({ getSet: vi.fn().mockRejectedValue(new Error('not found')) });
    const { result } = renderHook(() => useWorkbench(), { wrapper: wrapper(fakeApi) });

    await expect(result.current.load('nope')).rejects.toThrow('not found');
    await expect(result.current.load('nope')).rejects.toBeInstanceOf(Error);
  });
});

describe('WorkbenchProvider under React.StrictMode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // `reactStrictMode: true` makes StrictMode the literal root that
  // renderHook renders, with `wrapper(fakeApi)` (WorkbenchProvider) nested
  // beneath it. That reproduces React's real dev-mode mount -> cleanup ->
  // mount cycle for the provider's effects: passing a wrapper that itself
  // renders `<StrictMode>` around its children does not, because the
  // wrapper component then sits *above* StrictMode in the tree and React
  // only double-invokes effects for the subtree StrictMode itself roots.
  it('run() still resolves into state.wb.result after the StrictMode mount/cleanup/mount cycle', async () => {
    const fakeApi = makeFakeApi({
      run: vi.fn().mockResolvedValue({ questions: {} }),
    });
    const { result } = renderHook(() => useWorkbench(), {
      wrapper: wrapper(fakeApi),
      reactStrictMode: true,
    });

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.state.wb.result).toEqual({ questions: {} });
    expect(result.current.state.wb.running).toBe(false);
  });

  it('a failing run still lands in state.wb.error after the StrictMode mount/cleanup/mount cycle', async () => {
    const fakeApi = makeFakeApi({
      run: vi
        .fn()
        .mockRejectedValue(
          new ApiError('validation', 'bad question', { path: 'questions.crashed' }),
        ),
    });
    const { result } = renderHook(() => useWorkbench(), {
      wrapper: wrapper(fakeApi),
      reactStrictMode: true,
    });

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.state.wb.error).toEqual({
      kind: 'validation',
      message: 'bad question',
      path: 'questions.crashed',
    });
    expect(result.current.state.wb.running).toBe(false);
  });
});

describe('mode persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists mode to localStorage', async () => {
    const fakeApi = makeFakeApi();
    const { result } = renderHook(() => useWorkbench(), { wrapper: wrapper(fakeApi) });

    act(() => {
      result.current.dispatch({ type: 'setMode', mode: 'json' });
    });

    await waitFor(() => expect(localStorage.getItem('jev-ui.mode')).toBe('json'));
  });

  it('reads a persisted mode back on init', () => {
    localStorage.setItem('jev-ui.mode', 'form');
    const s = initialWeb(SAMPLE_REQUEST);
    expect(s.mode).toBe('form');
  });

  it('a throwing localStorage does not crash the provider', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const fakeApi = makeFakeApi();
    const { result } = renderHook(() => useWorkbench(), { wrapper: wrapper(fakeApi) });

    act(() => {
      result.current.dispatch({ type: 'setMode', mode: 'json' });
    });

    await waitFor(() => expect(result.current.state.mode).toBe('json'));
  });
});
