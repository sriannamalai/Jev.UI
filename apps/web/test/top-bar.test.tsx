import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { newRequest, toCurl, toPython, type QuestionSet } from '@jev-ui/core/browser';
import { createApi } from '../src/api.js';
import { WorkbenchProvider, useWorkbench } from '../src/store.js';
import { TopBar } from '../src/components/index.js';
import { useServerInfo } from '../src/hooks/useServerInfo.js';

type Api = ReturnType<typeof createApi>;

function makeResult(model = 'jev-latest') {
  return {
    answers: {},
    model,
    usage: { inputTokens: 1, outputTokens: 1 },
    latencyMs: 5,
    costUsd: 0.001,
  };
}

function makeApi(overrides: Partial<Api> = {}): Api {
  return {
    health: vi.fn(async () => ({ keyConfigured: true, version: '1.0.0', setsDir: '/sets' })),
    models: vi.fn(async () => []),
    run: vi.fn(async () => makeResult()),
    listSets: vi.fn(async () => []),
    getSet: vi.fn(async () => {
      throw new Error('not used in this test');
    }),
    putSet: vi.fn(async () => {}),
    ...overrides,
  };
}

// `TopBar` no longer fetches health/models/sets itself (the shell owns that
// single fetch and passes it down) — this small wrapper reproduces the old
// "TopBar fetches its own server info" test setup without changing any
// individual test body.
function ServerInfoTopBar(props: { api: Api }) {
  const serverInfo = useServerInfo(props.api);
  return <TopBar serverInfo={serverInfo} />;
}

function renderBar(api: Api, extra?: React.ReactNode) {
  return render(
    <WorkbenchProvider api={api}>
      {extra}
      <ServerInfoTopBar api={api} />
    </WorkbenchProvider>,
  );
}

function ModelReadout() {
  const { state } = useWorkbench();
  return <span data-testid="model-readout">{state.wb.request.model}</span>;
}

function ErrorReadout() {
  const { state } = useWorkbench();
  return <span data-testid="wb-error">{state.wb.error?.message ?? 'none'}</span>;
}

const triageSet: QuestionSet = {
  name: 'triage',
  questions: { q: { type: 'noul', instructions: 'hi' } },
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('TopBar', () => {
  it('loads and renders sets, models, and health', async () => {
    const api = makeApi({
      listSets: vi.fn(async () => [{ name: 'triage', questionCount: 2, valid: true }]),
      models: vi.fn(async () => [{ name: 'jev-latest', description: '', releaseDate: '' }]),
    });
    renderBar(api);
    await waitFor(() => expect(screen.getByRole('option', { name: 'triage' })).toBeInTheDocument());
    expect(await screen.findByRole('img', { name: 'API key detected' })).toBeInTheDocument();
  });

  it('disables an invalid set option and uses its error as the title', async () => {
    const api = makeApi({
      listSets: vi.fn(async () => [
        { name: 'broken', questionCount: 0, valid: false, error: 'bad json' },
      ]),
    });
    renderBar(api);
    const option = await screen.findByRole('option', { name: 'broken' });
    expect(option).toBeDisabled();
    expect(option).toHaveAttribute('title', 'bad json');
  });

  it('loading a set calls api.getSet and replaces the request', async () => {
    const api = makeApi({
      listSets: vi.fn(async () => [{ name: 'triage', questionCount: 1, valid: true }]),
      getSet: vi.fn(async () => triageSet),
    });
    renderBar(api);
    await screen.findByRole('option', { name: 'triage' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Set'), { target: { value: 'triage' } });
    });
    expect(api.getSet).toHaveBeenCalledWith('triage');
    await waitFor(() => expect(screen.getByLabelText('Set')).toHaveValue('triage'));
  });

  it('confirms discarding unsaved changes before loading a set, and Cancel leaves things unchanged', async () => {
    function Dirtier() {
      const { dispatch } = useWorkbench();
      return (
        <button
          type="button"
          onClick={() => dispatch({ type: 'wb', action: { type: 'setState', state: 'edited' } })}
        >
          make-dirty
        </button>
      );
    }
    const api = makeApi({
      listSets: vi.fn(async () => [{ name: 'triage', questionCount: 1, valid: true }]),
      getSet: vi.fn(async () => triageSet),
    });
    renderBar(api, <Dirtier />);
    await screen.findByRole('option', { name: 'triage' });
    act(() => {
      screen.getByText('make-dirty').click();
    });

    const select = screen.getByLabelText('Set');
    fireEvent.change(select, { target: { value: 'triage' } });
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();

    act(() => {
      screen.getByText('Cancel').click();
    });
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
    expect(api.getSet).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: 'triage' } });
    await act(async () => {
      screen.getByText('Load').click();
    });
    expect(api.getSet).toHaveBeenCalledWith('triage');
  });

  it('dispatches setModel for a typed pinned id, but not for an empty value', async () => {
    const api = makeApi();
    renderBar(api, <ModelReadout />);
    expect(screen.getByTestId('model-readout')).toHaveTextContent('jev-latest');

    const input = screen.getByLabelText('Model') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'pinned-id-123' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('model-readout')).toHaveTextContent('pinned-id-123');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('model-readout')).toHaveTextContent('pinned-id-123');
    expect(input.value).toBe('pinned-id-123');
  });

  it('shows the resolved model after a run whose result model differs from the alias', async () => {
    const api = makeApi({ run: vi.fn(async () => makeResult('jev-1.13.0')) });
    renderBar(api);
    const runButton = await screen.findByRole('button', { name: /Run/ });
    await act(async () => {
      fireEvent.click(runButton);
    });
    expect(await screen.findByText('→ jev-1.13.0')).toBeInTheDocument();
  });

  it('flips aria-pressed and the mode when a mode button is clicked', async () => {
    const api = makeApi();
    renderBar(api);
    const jsonButton = screen.getByRole('button', { name: 'JSON' });
    expect(jsonButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(jsonButton);
    expect(jsonButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('Save calls putSet directly when a set name is already known', async () => {
    const api = makeApi({
      listSets: vi.fn(async () => [{ name: 'triage', questionCount: 1, valid: true }]),
      getSet: vi.fn(async () => triageSet),
    });
    renderBar(api);
    await screen.findByRole('option', { name: 'triage' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Set'), { target: { value: 'triage' } });
    });

    const saveButton = await screen.findByRole('button', { name: 'Save' });
    await act(async () => {
      fireEvent.click(saveButton);
    });
    expect(api.putSet).toHaveBeenCalledWith('triage', expect.objectContaining({ name: 'triage' }));
  });

  it('Save without a set name validates live, rejects a bad name, then accepts and refreshes sets', async () => {
    const api = makeApi();
    renderBar(api);

    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    const nameInput = screen.getByLabelText('Set name');

    fireEvent.change(nameInput, { target: { value: 'Bad Name' } });
    expect(
      screen.getByText('Use lowercase letters, digits, - or _ (must start with a letter or digit)'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(api.putSet).not.toHaveBeenCalled();

    fireEvent.change(nameInput, { target: { value: 'triage' } });
    expect(
      screen.queryByText(
        'Use lowercase letters, digits, - or _ (must start with a letter or digit)',
      ),
    ).toBeNull();

    const listSetsCallsBefore = (api.listSets as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(api.putSet).toHaveBeenCalledWith('triage', expect.anything());
    await waitFor(() =>
      expect((api.listSets as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        listSetsCallsBefore,
      ),
    );
  });

  it('shows an alert on a save rejection and leaves wb.error undefined', async () => {
    const api = makeApi({
      putSet: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    renderBar(api, <ErrorReadout />);

    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    fireEvent.change(screen.getByLabelText('Set name'), { target: { value: 'triage' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
    expect(screen.getByTestId('wb-error')).toHaveTextContent('none');
  });

  it('exports cURL to the clipboard and shows a transient Copied status', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const api = makeApi();
    renderBar(api);

    fireEvent.click(screen.getByRole('button', { name: 'Export code' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'cURL' }));
    });

    expect(writeText).toHaveBeenCalledWith(toCurl(newRequest()));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
  });

  it('opens a code dialog when the clipboard write rejects, and Escape closes it', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });
    const api = makeApi();
    renderBar(api);

    fireEvent.click(screen.getByRole('button', { name: 'Export code' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Python' }));
    });

    const dialog = await screen.findByRole('dialog', { name: 'Exported code' });
    expect(within(dialog).getByRole('textbox')).toHaveValue(toPython(newRequest()));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables Run with a title when the API key is not configured', async () => {
    const api = makeApi({
      health: vi.fn(async () => ({ keyConfigured: false, version: 'x', setsDir: '' })),
    });
    renderBar(api);
    const runButton = await screen.findByRole('button', { name: /Run/ });
    await waitFor(() => expect(runButton).toBeDisabled());
    expect(runButton).toHaveAttribute('title', 'No API key configured');
  });

  it('enables Run when the API key is configured', async () => {
    const api = makeApi();
    renderBar(api);
    await screen.findByRole('img', { name: 'API key detected' });
    expect(screen.getByRole('button', { name: /Run/ })).not.toBeDisabled();
  });

  it('runs on Ctrl+Enter and Meta+Enter, and does nothing when Run is disabled', async () => {
    const run = vi.fn(async () => makeResult());
    const api = makeApi({ run });
    renderBar(api);
    await screen.findByRole('button', { name: /Run/ });

    const runButton = screen.getByRole('button', { name: /Run/ });

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    // Wait for the run to fully settle (running flips back to false) before
    // firing the next shortcut — otherwise it can race the in-flight run
    // and be dropped by the store's own re-entrancy guard.
    await waitFor(() => expect(runButton).toHaveAttribute('aria-busy', 'false'));

    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it('does not run on Ctrl+Enter when Run is disabled', async () => {
    const run = vi.fn(async () => makeResult());
    const api = makeApi({
      health: vi.fn(async () => ({ keyConfigured: false, version: 'x', setsDir: '' })),
      run,
    });
    renderBar(api);
    await waitFor(async () =>
      expect(await screen.findByRole('button', { name: /Run/ })).toBeDisabled(),
    );

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('a failing api.models() still leaves sets and health rendered', async () => {
    const api = makeApi({
      models: vi.fn(async () => {
        throw new Error('boom');
      }),
      listSets: vi.fn(async () => [{ name: 'triage', questionCount: 1, valid: true }]),
    });
    renderBar(api);
    await screen.findByRole('option', { name: 'triage' });
    await screen.findByRole('img', { name: 'API key detected' });
  });

  it('toggles the theme, reflecting and persisting it', async () => {
    const api = makeApi();
    renderBar(api);
    const button = screen.getByRole('button', { name: /Switch to (dark|light) theme/ });
    const before = document.documentElement.dataset.theme;

    fireEvent.click(button);

    const after = document.documentElement.dataset.theme;
    expect(after).not.toBe(before);
    expect(localStorage.getItem('jev-ui.theme')).toBe(after);
  });

  it('does not crash when localStorage throws', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      expect(() => renderBar(makeApi())).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
