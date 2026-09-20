import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  costUsd,
  estimateTokens,
  formatUsd,
  type Request,
  type RunResult,
} from '@jev-ui/core/browser';
import { WorkbenchProvider, useWorkbench } from '../src/store.js';
import { ResultsPane, StatusBar } from '../src/components/index.js';

const quickStartRequest: Request = {
  state:
    "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.",
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
    frustration: {
      type: 'score',
      instructions: 'How frustrated the customer appears',
      criteria: ['Calm, just stating facts', 'Frustrated but civil', 'Very angry, strong language'],
    },
    is_urgent: {
      type: 'noul',
      instructions: 'The message conveys urgency or time-sensitivity',
    },
  },
};

const quickStartResult: RunResult = {
  model: 'jev-1.13.0',
  usage: { inputTokens: 425, outputTokens: 73 },
  latencyMs: 894.2,
  costUsd: 0.00001785,
  answers: {
    // Deliberately in a different order than the request's questions to
    // verify ResultsPane re-orders by request order, not answer order.
    is_urgent: { type: 'noul', noul: 0.99 },
    frustration: {
      type: 'score',
      score: 1.0,
      confidence: 1.0,
      legend: {
        '0': 'Calm, just stating facts',
        '1': 'Frustrated but civil',
        '2': 'Very angry, strong language',
      },
      probabilities: { '0': 0, '1': 1, '2': 0 },
    },
    department: {
      type: 'choice',
      choice: 'technical',
      confidence: 0.75,
      probabilities: { technical: 0.84, sales: 0.0, billing: 0.16 },
    },
  },
};

function RunActions(props: { result: RunResult }) {
  const { dispatch } = useWorkbench();
  return (
    <div>
      <button type="button" onClick={() => dispatch({ type: 'wb', action: { type: 'runStart' } })}>
        run-start
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: 'wb', action: { type: 'runOk', result: props.result } })}
      >
        run-ok
      </button>
    </div>
  );
}

function SelectedProbe() {
  const { state } = useWorkbench();
  return <pre data-testid="selected">{state.wb.selectedId ?? ''}</pre>;
}

function EditButton() {
  const { dispatch } = useWorkbench();
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'wb', action: { type: 'setState', state: 'edited state' } })}
    >
      edit
    </button>
  );
}

async function runToOk(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'run-start' }));
  await user.click(screen.getByRole('button', { name: 'run-ok' }));
}

describe('ResultsPane', () => {
  it('shows an empty-state message before any run', () => {
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
      </WorkbenchProvider>,
    );
    expect(screen.getByText('Run the request to see answers here.')).toBeInTheDocument();
  });

  it('renders the choice answer with the winner and probability-sorted meters', async () => {
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={quickStartResult} />
      </WorkbenchProvider>,
    );
    await runToOk();

    const block = screen.getByRole('button', { name: 'department result' });
    expect(block.querySelector('.answer')?.textContent).toContain('technical');

    const meters = within(block).getAllByRole('meter');
    expect(meters.map((m) => m.getAttribute('aria-valuenow'))).toEqual(['0.84', '0.16', '0']);
    expect(meters.map((m) => m.getAttribute('aria-label'))).toEqual([
      'technical probability',
      'billing probability',
      'sales probability',
    ]);
  });

  it('marks a confidence below LOW_CONFIDENCE with the mid class, and not otherwise', async () => {
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={quickStartResult} />
      </WorkbenchProvider>,
    );
    await runToOk();

    const departmentChip = screen
      .getByRole('button', { name: 'department result' })
      .querySelector('.conf');
    expect(departmentChip?.className).toContain('mid');

    const frustrationChip = screen
      .getByRole('button', { name: 'frustration result' })
      .querySelector('.conf');
    expect(frustrationChip?.className).not.toContain('mid');
  });

  it('positions the score marker and shows the legend text of the nearest level', async () => {
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={quickStartResult} />
      </WorkbenchProvider>,
    );
    await runToOk();

    const block = screen.getByRole('button', { name: 'frustration result' });
    const marker = block.querySelector<HTMLElement>('.mark');
    expect(marker?.style.left).toBe('50%');
    expect(block.querySelector('.answer')?.textContent).toContain('Frustrated but civil');

    const labels = Array.from(block.querySelectorAll('.dist .lab')).map((el) => el.textContent);
    expect(labels).toEqual([
      '0 · Calm, just stating facts',
      '1 · Frustrated but civil',
      '2 · Very angry, strong language',
    ]);
  });

  it('places the marker at score/(levels-1) for a score between levels', async () => {
    const result: RunResult = {
      ...quickStartResult,
      answers: {
        frustration: {
          type: 'score',
          score: 1.6,
          confidence: 1.0,
          legend: {
            '0': 'Calm, just stating facts',
            '1': 'Frustrated but civil',
            '2': 'Very angry, strong language',
          },
          probabilities: { '0': 0, '1': 0.2, '2': 0.8 },
        },
      },
    };
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={result} />
      </WorkbenchProvider>,
    );
    await runToOk();

    const block = screen.getByRole('button', { name: 'frustration result' });
    const marker = block.querySelector<HTMLElement>('.mark');
    expect(marker?.style.left).toBe('80%');
    expect(block.querySelector('.answer')?.textContent).toContain('Very angry, strong language');
  });

  it('renders the noul meter and the yes/no word', async () => {
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={quickStartResult} />
      </WorkbenchProvider>,
    );
    await runToOk();

    const block = screen.getByRole('button', { name: 'is_urgent result' });
    const meter = within(block).getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('0.99');
    expect(block.querySelector('.answer')?.textContent).toContain('yes');
  });

  it('shows "no" below 0.5', async () => {
    const result: RunResult = {
      ...quickStartResult,
      answers: { is_urgent: { type: 'noul', noul: 0.2 } },
    };
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={result} />
      </WorkbenchProvider>,
    );
    await runToOk();

    const block = screen.getByRole('button', { name: 'is_urgent result' });
    expect(block.querySelector('.answer')?.textContent).toContain('no');
  });

  it('renders blocks in request order even though the answers object lists them differently', async () => {
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={quickStartResult} />
      </WorkbenchProvider>,
    );
    await runToOk();

    const names = screen
      .getAllByRole('button')
      .map((el) => el.getAttribute('aria-label'))
      .filter((name): name is string => name !== null && name.endsWith(' result'));
    expect(names).toEqual(['department result', 'frustration result', 'is_urgent result']);
  });

  it('drops an answer whose question no longer exists in the request', async () => {
    const result: RunResult = {
      ...quickStartResult,
      answers: { ...quickStartResult.answers, ghost: { type: 'noul', noul: 0.5 } },
    };
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={result} />
      </WorkbenchProvider>,
    );
    await runToOk();

    expect(screen.queryByRole('button', { name: 'ghost result' })).not.toBeInTheDocument();
  });

  it('shows the stale chip once the request changes after a run', async () => {
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={quickStartResult} />
        <EditButton />
      </WorkbenchProvider>,
    );
    await runToOk();
    expect(screen.queryByText('stale — request changed')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'edit' }));
    expect(screen.getByText('stale — request changed')).toBeInTheDocument();
  });

  it('sets aria-busy while a run is in flight', async () => {
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={quickStartResult} />
      </WorkbenchProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'run-start' }));
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByText('Running…')).toBeInTheDocument();
  });

  it('selects a block on click, and on Enter when focused', async () => {
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={quickStartResult} />
        <SelectedProbe />
      </WorkbenchProvider>,
    );
    await runToOk();

    const user = userEvent.setup();
    const frustrationBlock = screen.getByRole('button', { name: 'frustration result' });
    await user.click(frustrationBlock);
    expect(screen.getByTestId('selected').textContent).toBe('frustration');

    const departmentBlock = screen.getByRole('button', { name: 'department result' });
    departmentBlock.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('selected').textContent).toBe('department');
  });

  it('renders a NaN probability as – with a 0-width bar, without throwing', async () => {
    const result: RunResult = {
      ...quickStartResult,
      answers: {
        department: {
          type: 'choice',
          choice: 'technical',
          confidence: 0.75,
          probabilities: { technical: NaN, sales: 0.1, billing: 0.2 },
        },
      },
    };

    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <ResultsPane />
        <RunActions result={result} />
      </WorkbenchProvider>,
    );
    await runToOk();

    const block = screen.getByRole('button', { name: 'department result' });
    const meters = within(block).getAllByRole('meter');
    const nanMeter = meters.find((m) => m.getAttribute('aria-label') === 'technical probability');
    expect(nanMeter?.querySelector('i')?.style.width).toBe('0%');
    expect(within(block).getByText('–')).toBeInTheDocument();
  });
});

describe('StatusBar', () => {
  it('shows resolved model, latency, input tokens and cost after a run', async () => {
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <StatusBar />
        <RunActions result={quickStartResult} />
      </WorkbenchProvider>,
    );
    await runToOk();

    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toContain('jev-1.13.0');
    expect(footer.textContent).toContain('894 ms');
    expect(footer.textContent).toContain('425 tok');
    expect(footer.textContent).toContain('$0.000018');
  });

  it('shows estimated tokens and cost before any run', () => {
    render(
      <WorkbenchProvider initial={quickStartRequest}>
        <StatusBar />
      </WorkbenchProvider>,
    );
    const footer = screen.getByRole('contentinfo');
    const n = estimateTokens(quickStartRequest);
    expect(footer.textContent).toContain(`≈ ${n} tok`);
    expect(footer.textContent).toContain(`≈ ${formatUsd(costUsd(n))}`);
  });
});
