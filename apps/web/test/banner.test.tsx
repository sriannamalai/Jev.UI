import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { JevErrorKind, Request } from '@jev-ui/core/browser';
import { ApiError, createApi } from '../src/api.js';
import { WorkbenchProvider, useWorkbench } from '../src/store.js';
import { Banner, SetupScreen } from '../src/components/index.js';

type Api = ReturnType<typeof createApi>;

const request: Request = {
  state: 'hi',
  model: 'jev-latest',
  questions: { q: { type: 'noul', instructions: 'x' } },
};

function fakeApi(run: Api['run']): Api {
  return {
    health: async () => ({ keyConfigured: true, version: 'x', setsDir: '' }),
    models: async () => [],
    run,
    listSets: async () => [],
    getSet: async () => {
      throw new Error('not used in this test');
    },
    putSet: async () => {},
  };
}

function ErrorSetter(props: { error: { kind: JevErrorKind; message: string; path?: string } }) {
  const { dispatch } = useWorkbench();
  return (
    <button
      type="button"
      onClick={() => {
        // `runFail` is a no-op unless the workbench is `running` (see
        // `workbenchReducer`), so drive it through the same `runStart` ->
        // `runFail` sequence the real `run()` uses.
        dispatch({ type: 'wb', action: { type: 'runStart' } });
        dispatch({ type: 'wb', action: { type: 'runFail', error: props.error } });
      }}
    >
      set-error
    </button>
  );
}

const LEADS: Record<JevErrorKind, string> = {
  auth: 'API key rejected',
  noKey: 'No API key configured',
  rateLimit: 'Rate limited',
  overloaded: 'TypeSafe is overloaded',
  network: 'Cannot reach the server',
  timeout: 'Request timed out',
  validation: 'Request rejected',
  unexpected: 'Unexpected error',
};

const RETRYABLE: readonly JevErrorKind[] = ['rateLimit', 'overloaded', 'network', 'timeout'];
const ALL_KINDS: readonly JevErrorKind[] = [
  'auth',
  'noKey',
  'rateLimit',
  'overloaded',
  'network',
  'timeout',
  'validation',
  'unexpected',
];

describe('Banner', () => {
  it('renders nothing when there is no error', () => {
    const { container } = render(
      <WorkbenchProvider initial={request} api={fakeApi(vi.fn())}>
        <Banner />
      </WorkbenchProvider>,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  for (const kind of ALL_KINDS) {
    it(`shows the lead text for kind "${kind}"`, () => {
      render(
        <WorkbenchProvider initial={request} api={fakeApi(vi.fn())}>
          <ErrorSetter error={{ kind, message: 'boom' }} />
          <Banner />
        </WorkbenchProvider>,
      );
      act(() => {
        screen.getByText('set-error').click();
      });
      expect(screen.getByRole('alert')).toHaveTextContent(LEADS[kind]);
      expect(screen.getByRole('alert')).toHaveTextContent('boom');
    });

    if (RETRYABLE.includes(kind)) {
      it(`shows a Retry button for retryable kind "${kind}"`, () => {
        render(
          <WorkbenchProvider initial={request} api={fakeApi(vi.fn())}>
            <ErrorSetter error={{ kind, message: 'boom' }} />
            <Banner />
          </WorkbenchProvider>,
        );
        act(() => {
          screen.getByText('set-error').click();
        });
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });
    } else {
      it(`shows no Retry button for non-retryable kind "${kind}"`, () => {
        render(
          <WorkbenchProvider initial={request} api={fakeApi(vi.fn())}>
            <ErrorSetter error={{ kind, message: 'boom' }} />
            <Banner />
          </WorkbenchProvider>,
        );
        act(() => {
          screen.getByText('set-error').click();
        });
        expect(screen.queryByText('Retry')).toBeNull();
      });
    }
  }

  it('shows the path for a validation error that has one', () => {
    render(
      <WorkbenchProvider initial={request} api={fakeApi(vi.fn())}>
        <ErrorSetter
          error={{ kind: 'validation', message: 'must be a string', path: 'questions.q.criteria' }}
        />
        <Banner />
      </WorkbenchProvider>,
    );
    act(() => {
      screen.getByText('set-error').click();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Request rejected at questions.q.criteria');
  });

  it('calls api.run again when Retry is clicked', async () => {
    const run = vi.fn().mockRejectedValue(new ApiError('network', 'Cannot reach the server'));
    render(
      <WorkbenchProvider initial={request} api={fakeApi(run)}>
        <ErrorSetter error={{ kind: 'network', message: 'Cannot reach the server' }} />
        <Banner />
      </WorkbenchProvider>,
    );
    act(() => {
      screen.getByText('set-error').click();
    });
    expect(run).not.toHaveBeenCalled();

    await act(async () => {
      screen.getByText('Retry').click();
    });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('clears wb.error when Dismiss is clicked', () => {
    render(
      <WorkbenchProvider initial={request} api={fakeApi(vi.fn())}>
        <ErrorSetter error={{ kind: 'auth', message: 'boom' }} />
        <Banner />
      </WorkbenchProvider>,
    );
    act(() => {
      screen.getByText('set-error').click();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    act(() => {
      screen.getByText('Dismiss').click();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SetupScreen', () => {
  it('renders the notice when keyConfigured is false', () => {
    render(<SetupScreen keyConfigured={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('No API key found');
    expect(screen.getByText('TYPESAFE_API_KEY')).toBeInTheDocument();
  });

  it('renders nothing when keyConfigured is true', () => {
    const { container } = render(<SetupScreen keyConfigured={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when keyConfigured is undefined', () => {
    const { container } = render(<SetupScreen keyConfigured={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
