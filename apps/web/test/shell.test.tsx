// The application shell: TopBar + Build/JSON/Results columns +
// StatusBar assembled by `Workbench`, and the narrow-viewport tab fallback
// for Split mode. The JSON pane's CodeMirror instance is heavy and already
// has its own tests (test/json-pane.test.tsx); it's mocked here to a plain
// stub so these tests can focus on the shell's mount/unmount and layout
// logic without paying for a real editor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Request, RunResult } from '@jev-ui/core/browser';
import { ApiError, createApi } from '../src/api.js';
import { WorkbenchProvider } from '../src/store.js';
import { Workbench } from '../src/components/index.js';

vi.mock('../src/components/JsonPane.js', () => ({
  JsonPane: () => <div data-testid="json-pane" />,
}));

type Api = ReturnType<typeof createApi>;

const choiceRequest: Request = {
  state: 'a customer message',
  model: 'jev-latest',
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which team should handle this',
      criteria: {
        billing: 'Payment or subscription issues',
        technical: 'Bugs or integration problems',
        sales: 'Pricing or account questions',
      },
    },
  },
};

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    model: 'jev-1.13.0',
    usage: { inputTokens: 10, outputTokens: 2 },
    latencyMs: 12,
    costUsd: 0.0001,
    answers: {
      department: {
        type: 'choice',
        choice: 'technical',
        confidence: 0.75,
        probabilities: { technical: 0.84, billing: 0.16, sales: 0 },
      },
    },
    ...overrides,
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

function renderShell(api: Api, initial?: Request) {
  return render(
    <WorkbenchProvider api={api} initial={initial}>
      <Workbench api={api} />
    </WorkbenchProvider>,
  );
}

function stubMatchMedia(matches: boolean): void {
  const mql = {
    matches,
    media: '',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Workbench shell', () => {
  it('renders Build, Request JSON, and Results by default (split mode)', async () => {
    const api = makeApi();
    renderShell(api);
    expect(await screen.findByRole('region', { name: 'Build' })).toBeInTheDocument();
    expect(screen.getByTestId('json-pane')).toBeInTheDocument();
    expect(screen.getByText('Results')).toBeInTheDocument();
  });

  it('unmounts the JSON pane in Form mode and the Build column in JSON mode', async () => {
    const api = makeApi();
    renderShell(api);
    await screen.findByRole('region', { name: 'Build' });

    fireEvent.click(screen.getByRole('button', { name: 'Form' }));
    expect(screen.queryByTestId('json-pane')).toBeNull();
    expect(screen.getByRole('region', { name: 'Build' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(screen.queryByRole('region', { name: 'Build' })).toBeNull();
    expect(screen.getByTestId('json-pane')).toBeInTheDocument();
  });

  it('fetches health exactly once for the whole page', async () => {
    const api = makeApi();
    renderShell(api);
    await screen.findByRole('region', { name: 'Build' });
    expect(api.health).toHaveBeenCalledTimes(1);
  });

  it('shows the setup notice, disables Run, and still allows editing the state', async () => {
    const api = makeApi({
      health: vi.fn(async () => ({ keyConfigured: false, version: 'x', setsDir: '' })),
    });
    renderShell(api);

    expect(await screen.findByText('No API key found')).toBeInTheDocument();
    const runButton = await screen.findByRole('button', { name: /Run/ });
    await waitFor(() => expect(runButton).toBeDisabled());

    const stateField = screen.getByLabelText('State');
    fireEvent.change(stateField, { target: { value: 'edited state' } });
    expect(stateField).toHaveValue('edited state');
  });

  it('runs and renders the answer in Results, with the model shown in the status bar', async () => {
    const api = makeApi({ run: vi.fn(async () => makeResult()) });
    renderShell(api, choiceRequest);

    const runButton = await screen.findByRole('button', { name: /Run/ });
    await act(async () => {
      fireEvent.click(runButton);
    });

    expect(await screen.findByText('technical', { selector: '.answer' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('jev-1.13.0');
  });

  it('shows the banner on a network failure, and Retry re-invokes run', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('network', 'Cannot reach the server'))
      .mockResolvedValue(makeResult());
    const api = makeApi({ run });
    renderShell(api, choiceRequest);

    const runButton = await screen.findByRole('button', { name: /Run/ });
    await act(async () => {
      fireEvent.click(runButton);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');
    expect(run).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByText('Retry'));
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  describe('narrow viewport', () => {
    it('shows a Build/JSON tablist in Split mode, switching panels with ArrowRight, keeping Results visible', async () => {
      stubMatchMedia(true);
      const api = makeApi();
      renderShell(api);

      const tablist = await screen.findByRole('tablist');
      const buildTab = screen.getByRole('tab', { name: 'Build' });
      const jsonTab = screen.getByRole('tab', { name: 'JSON' });
      expect(buildTab).toHaveAttribute('aria-selected', 'true');
      expect(jsonTab).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByRole('region', { name: 'Build' })).toBeInTheDocument();
      expect(screen.queryByTestId('json-pane')).toBeNull();

      fireEvent.keyDown(tablist, { key: 'ArrowRight' });
      expect(jsonTab).toHaveAttribute('aria-selected', 'true');
      expect(buildTab).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByTestId('json-pane')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Build' })).toBeNull();

      expect(screen.getByText('Results')).toBeInTheDocument();
    });

    it('renders the wide layout when matchMedia throws', async () => {
      vi.stubGlobal('matchMedia', () => {
        throw new Error('not supported');
      });
      const api = makeApi();
      renderShell(api);

      expect(await screen.findByRole('region', { name: 'Build' })).toBeInTheDocument();
      expect(screen.getByTestId('json-pane')).toBeInTheDocument();
      expect(screen.queryByRole('tablist')).toBeNull();
    });
  });
});
