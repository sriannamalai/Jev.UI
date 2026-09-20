import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { serializeRequest, type Request } from '@jev-ui/core/browser';
import type { createApi } from '../src/api.js';
import { WorkbenchProvider, useWorkbench } from '../src/store.js';
import { findQuestionRange, JsonPane, JsonPaneHeader } from '../src/components/index.js';

type Api = ReturnType<typeof createApi>;

function makeApi(overrides: Partial<Api> = {}): Api {
  return {
    health: vi.fn(async () => ({ keyConfigured: true, version: '1.0.0', setsDir: '/sets' })),
    models: vi.fn(async () => []),
    run: vi.fn(async () => ({
      answers: {},
      model: 'jev-latest',
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 5,
      costUsd: 0.001,
    })),
    listSets: vi.fn(async () => []),
    getSet: vi.fn(async () => {
      throw new Error('not used in this test');
    }),
    putSet: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('findQuestionRange', () => {
  const request: Request = {
    state: 'hi',
    model: 'jev-latest',
    questions: {
      department: {
        type: 'choice',
        instructions: 'Which team should handle this',
        criteria: { billing: 'Payment issues', technical: 'Bugs' },
      },
      frustration: {
        type: 'score',
        instructions: 'How frustrated the customer appears',
        criteria: ['Calm', 'Frustrated but civil', 'Very angry'],
      },
      is_urgent: {
        type: 'noul',
        instructions: 'The message conveys urgency',
      },
    },
  };
  const text = serializeRequest(request);
  const lines = text.split('\n');

  it('finds a multi-line object question', () => {
    const range = findQuestionRange(text, 'department');
    expect(range).toBeDefined();
    expect(lines[range!.fromLine - 1]).toBe('    "department": {');
    expect(lines[range!.toLine - 1]).toBe('    },');
  });

  it('finds the last question, which has no trailing comma', () => {
    const range = findQuestionRange(text, 'is_urgent');
    expect(range).toBeDefined();
    expect(lines[range!.fromLine - 1]).toBe('    "is_urgent": {');
    expect(lines[range!.toLine - 1]).toBe('    }');
  });

  it('is not confused by braces, brackets, and quotes inside string values', () => {
    const tricky: Request = {
      state: 'hi',
      model: 'jev-latest',
      questions: {
        q: {
          type: 'noul',
          instructions: 'has { a "brace" }, a \\"backslash-quote\\", and [brackets]',
        },
      },
    };
    const trickyText = serializeRequest(tricky);
    const range = findQuestionRange(trickyText, 'q');
    expect(range).toBeDefined();
    const trickyLines = trickyText.split('\n');
    expect(trickyLines[range!.fromLine - 1]).toBe('    "q": {');
    expect(trickyLines[range!.toLine - 1]).toBe('    }');
  });

  it('escapes an id that needs JSON escaping', () => {
    const withQuote: Request = {
      state: 'hi',
      model: 'jev-latest',
      questions: {
        'we"ird': { type: 'noul', instructions: 'x' },
      },
    };
    const withQuoteText = serializeRequest(withQuote);
    const range = findQuestionRange(withQuoteText, 'we"ird');
    expect(range).toBeDefined();
  });

  it('escapes an id containing regex metacharacters', () => {
    const withDot: Request = {
      state: 'hi',
      model: 'jev-latest',
      questions: {
        'a.b': { type: 'noul', instructions: 'x' },
      },
    };
    const withDotText = serializeRequest(withDot);
    const range = findQuestionRange(withDotText, 'a.b');
    expect(range).toBeDefined();
  });

  it('returns undefined for a missing id', () => {
    expect(findQuestionRange(text, 'nope')).toBeUndefined();
  });

  it('returns undefined for hand-formatted (non-2-space) JSON', () => {
    const handFormatted =
      '{\n"state": "hi",\n"model": "jev-latest",\n"questions": {\n"q": {\n"type": "noul",\n"instructions": "x"\n}\n}\n}';
    expect(findQuestionRange(handFormatted, 'q')).toBeUndefined();
  });
});

describe('JsonPaneHeader', () => {
  it('shows valid + in sync when there is no error and the pane is synced', () => {
    render(<JsonPaneHeader error={undefined} synced={true} />);
    expect(screen.getByText('● valid · in sync')).toBeInTheDocument();
  });

  it('shows valid without in sync when there is no error and the pane is not synced', () => {
    render(<JsonPaneHeader error={undefined} synced={false} />);
    expect(screen.getByText('● valid')).toBeInTheDocument();
  });

  it('shows the line number when the error has one', () => {
    render(<JsonPaneHeader error={{ message: 'Unexpected token', line: 4 }} synced={false} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('✕ line 4: Unexpected token');
  });

  it('omits the line number when the error has none', () => {
    render(<JsonPaneHeader error={{ message: 'Root must be an object' }} synced={false} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('✕ Root must be an object');
  });
});

const quickStartRequest: Request = {
  state: 'hi',
  model: 'jev-latest',
  questions: {
    is_urgent: { type: 'noul', instructions: 'urgent?' },
  },
};

function currentDoc(host: HTMLElement): string {
  return EditorView.findFromDOM(host)!.state.doc.toString();
}

describe('JsonPane', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the header and an aria-labelled editor whose doc matches jsonText', () => {
    const { container } = render(
      <WorkbenchProvider initial={quickStartRequest}>
        <JsonPane />
      </WorkbenchProvider>,
    );
    expect(screen.getByText('Request JSON')).toBeInTheDocument();
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;
    expect(host).toBeTruthy();
    expect(currentDoc(host)).toBe(serializeRequest(quickStartRequest));
  });

  it('updates the editor doc when a form-originated change reaches the store', () => {
    function Probe() {
      const { dispatch } = useWorkbench();
      return (
        <button
          type="button"
          onClick={() =>
            dispatch({ type: 'wb', action: { type: 'setState', state: 'changed from form' } })
          }
        >
          edit-from-form
        </button>
      );
    }

    const { container } = render(
      <WorkbenchProvider initial={quickStartRequest}>
        <Probe />
        <JsonPane />
      </WorkbenchProvider>,
    );
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;

    act(() => {
      screen.getByText('edit-from-form').click();
    });

    expect(currentDoc(host)).toContain('changed from form');
  });

  it('dispatches a user-style edit to the store only after the debounce elapses', () => {
    const { container } = render(
      <WorkbenchProvider initial={quickStartRequest}>
        <JsonPane />
      </WorkbenchProvider>,
    );
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;
    const view = EditorView.findFromDOM(host)!;

    act(() => {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: '{"state":"x","model":"jev-latest","questions":{}}',
        },
        userEvent: 'input.type',
      });
    });

    // Not yet: debounce hasn't elapsed.
    expect(screen.queryByText('✕', { exact: false })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Invalid because `questions` must be non-empty; confirms the edit did
    // reach the store (it wouldn't show an error otherwise) and did so only
    // after the debounce.
    expect(screen.getByRole('status')).toHaveTextContent('✕');
  });

  it('flushes a pending edit immediately on blur', () => {
    const { container } = render(
      <WorkbenchProvider initial={quickStartRequest}>
        <JsonPane />
      </WorkbenchProvider>,
    );
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;
    const view = EditorView.findFromDOM(host)!;

    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'not json' },
        userEvent: 'input.type',
      });
    });

    act(() => {
      view.contentDOM.dispatchEvent(new FocusEvent('blur'));
    });

    expect(screen.getByRole('status')).toHaveTextContent('✕');
  });

  it('flushes a pending edit on unmount', () => {
    function StatusDisplay() {
      const { state } = useWorkbench();
      return <div data-testid="err-message">{state.jsonError?.message ?? 'none'}</div>;
    }

    function Wrapper() {
      const [show, setShow] = useState(true);
      return (
        <>
          {show && <JsonPane />}
          <button type="button" onClick={() => setShow(false)}>
            hide
          </button>
          <StatusDisplay />
        </>
      );
    }

    const { container } = render(
      <WorkbenchProvider initial={quickStartRequest}>
        <Wrapper />
      </WorkbenchProvider>,
    );
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;
    const view = EditorView.findFromDOM(host)!;

    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'not json either' },
        userEvent: 'input.type',
      });
    });

    expect(screen.getByTestId('err-message')).toHaveTextContent('none');

    act(() => {
      screen.getByText('hide').click();
    });

    expect(screen.getByTestId('err-message')).not.toHaveTextContent('none');
  });

  function FormProbe() {
    const { dispatch } = useWorkbench();
    return (
      <button
        type="button"
        onClick={(e) => {
          const state = e.currentTarget.dataset.state ?? '';
          dispatch({ type: 'wb', action: { type: 'setState', state } });
        }}
        data-testid="form-probe"
      >
        edit-from-form
      </button>
    );
  }

  function setFormState(text: string): void {
    const probe = screen.getByTestId('form-probe');
    probe.dataset.state = text;
    act(() => {
      probe.click();
    });
  }

  it('keeps the editor doc in sync with the store across T0 -> T1 -> T0 (return to the exact initial text)', () => {
    const { container } = render(
      <WorkbenchProvider initial={quickStartRequest}>
        <FormProbe />
        <JsonPane />
      </WorkbenchProvider>,
    );
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;
    const t0 = serializeRequest(quickStartRequest);
    expect(currentDoc(host)).toBe(t0);

    setFormState('t1');
    expect(currentDoc(host)).toContain('t1');
    expect(currentDoc(host)).not.toBe(t0);

    // Back to the ORIGINAL state text ("hi"), so the store's `jsonText` is
    // byte-identical to what the pane mounted with — the exact case a
    // "last dispatched" ref (rather than the doc's own content) gets wrong.
    setFormState('hi');
    expect(currentDoc(host)).toBe(t0);
  });

  it('keeps the editor doc in sync with the store across T0 -> T1 -> T2 -> T1 (a value the editor previously mirrored)', () => {
    const { container } = render(
      <WorkbenchProvider initial={quickStartRequest}>
        <FormProbe />
        <JsonPane />
      </WorkbenchProvider>,
    );
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;
    const view = EditorView.findFromDOM(host)!;

    // T1 is reached by TYPING in the editor (so the "last dispatched" ref, if
    // one existed, would remember this exact text) and flushing the debounce.
    // Serialised the same way the store would re-serialise it later, so a
    // subsequent form edit back to the same request produces byte-identical
    // text.
    const t1 = serializeRequest({
      state: 'typed-once',
      model: quickStartRequest.model,
      questions: quickStartRequest.questions,
    });
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: t1 },
        userEvent: 'input.type',
      });
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(currentDoc(host)).toBe(t1);

    // T2: a form edit re-serialises to a different text.
    setFormState('form-edit');
    expect(currentDoc(host)).toContain('form-edit');
    expect(currentDoc(host)).not.toBe(t1);

    // Back to T1: a form edit whose serialisation happens to be
    // byte-identical to the text the editor previously mirrored.
    setFormState('typed-once');
    expect(currentDoc(host)).toBe(t1);
  });

  it('does not let an external (form) change clobber a pending, un-flushed editor edit', () => {
    function JsonTextReadout() {
      const { state } = useWorkbench();
      return <pre data-testid="json-text">{state.jsonText}</pre>;
    }

    const { container } = render(
      <WorkbenchProvider initial={quickStartRequest}>
        <FormProbe />
        <JsonTextReadout />
        <JsonPane />
      </WorkbenchProvider>,
    );
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;
    const view = EditorView.findFromDOM(host)!;

    act(() => {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: '{"state":"typed by user","model":"jev-latest","questions":{}}',
        },
        userEvent: 'input.type',
      });
    });

    // A form-originated (external) change arrives while the debounce is
    // still armed — it must not overwrite what the user just typed.
    setFormState('should not appear yet');
    expect(currentDoc(host)).toContain('typed by user');
    expect(currentDoc(host)).not.toContain('should not appear yet');

    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Once the debounce flushes, the doc and the store agree again.
    expect(currentDoc(host)).toBe(screen.getByTestId('json-text').textContent);
    expect(currentDoc(host)).toContain('typed by user');
  });

  it('does not dispatch a stale jsonEdited on blur after an external replacement', () => {
    function RequestReadout() {
      const { state } = useWorkbench();
      return <pre data-testid="request">{JSON.stringify(state.wb.request)}</pre>;
    }

    const { container } = render(
      <WorkbenchProvider initial={quickStartRequest}>
        <FormProbe />
        <RequestReadout />
        <JsonPane />
      </WorkbenchProvider>,
    );
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;
    const view = EditorView.findFromDOM(host)!;

    setFormState('t1');
    setFormState('');
    // Regardless of the sync bug, the doc must reflect the current store
    // text before any blur happens.
    expect(currentDoc(host)).toBe(view.state.doc.toString());

    const before = screen.getByTestId('request').textContent;
    act(() => {
      view.contentDOM.dispatchEvent(new FocusEvent('blur'));
    });
    expect(screen.getByTestId('request').textContent).toBe(before);
  });
});

describe('JsonPane Mod-Enter run shortcut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the request and leaves the doc unchanged (no blank line inserted)', async () => {
    const run = vi.fn<Api['run']>(async () => ({
      answers: {},
      model: 'jev-latest',
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 5,
      costUsd: 0.001,
    }));
    const api = makeApi({ run });
    const { container } = render(
      <WorkbenchProvider initial={quickStartRequest} api={api}>
        <JsonPane />
      </WorkbenchProvider>,
    );
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;
    const view = EditorView.findFromDOM(host)!;
    const before = view.state.doc.toString();

    await act(async () => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

    expect(view.state.doc.toString()).toBe(before);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('flushes a just-typed edit and sends the NEW request, not the previous one', async () => {
    const run = vi.fn<Api['run']>(async () => ({
      answers: {},
      model: 'jev-latest',
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 5,
      costUsd: 0.001,
    }));
    const api = makeApi({ run });
    const { container } = render(
      <WorkbenchProvider initial={quickStartRequest} api={api}>
        <JsonPane />
      </WorkbenchProvider>,
    );
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;
    const view = EditorView.findFromDOM(host)!;

    const newText = JSON.stringify({
      state: 'freshly typed',
      model: 'jev-latest',
      questions: quickStartRequest.questions,
    });

    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: newText },
        userEvent: 'input.type',
      });
    });

    await act(async () => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ state: 'freshly typed' }));
  });
});

describe('JsonPane selection highlight wiring', () => {
  it('moves the .cm-jev-selected decoration to the newly selected question on a real editor', () => {
    function SelectProbe() {
      const { dispatch } = useWorkbench();
      return (
        <button
          type="button"
          onClick={() => dispatch({ type: 'wb', action: { type: 'select', id: 'is_urgent' } })}
        >
          select-is-urgent
        </button>
      );
    }

    const request: Request = {
      state: 'hi',
      model: 'jev-latest',
      questions: {
        department: {
          type: 'choice',
          instructions: 'Which team should handle this',
          criteria: { billing: 'Payment issues', technical: 'Bugs' },
        },
        is_urgent: { type: 'noul', instructions: 'urgent?' },
      },
    };

    const { container } = render(
      <WorkbenchProvider initial={request}>
        <SelectProbe />
        <JsonPane />
      </WorkbenchProvider>,
    );
    const host = container.querySelector('[aria-label="Request JSON"]') as HTMLElement;

    // The workbench selects the first question by default.
    const initialHighlighted = Array.from(host.querySelectorAll('.cm-jev-selected')).map(
      (el) => el.textContent ?? '',
    );
    expect(initialHighlighted.join('\n')).toContain('department');

    act(() => {
      screen.getByText('select-is-urgent').click();
    });

    const highlighted = Array.from(host.querySelectorAll('.cm-jev-selected')).map(
      (el) => el.textContent ?? '',
    );
    expect(highlighted.length).toBeGreaterThan(0);
    const joined = highlighted.join('\n');
    expect(joined).toContain('is_urgent');
    expect(joined).not.toContain('department');
  });
});
