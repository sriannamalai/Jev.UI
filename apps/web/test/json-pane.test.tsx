import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { serializeRequest, type Request } from '@jev-ui/core/browser';
import { WorkbenchProvider, useWorkbench } from '../src/store.js';
import { findQuestionRange, JsonPane, JsonPaneHeader } from '../src/components/index.js';

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
});
