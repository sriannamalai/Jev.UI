import type { Request, RunResult } from '@jev-ui/core';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { ResultsView, StatusLine } from '../src/tui/index.js';

const REQUEST: Request = {
  state: 'A customer wrote in.',
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which department?',
      criteria: { technical: null, sales: null, billing: null },
    },
    frustration: {
      type: 'score',
      instructions: 'How frustrated?',
      criteria: ['Calm, just stating facts', 'Frustrated but civil', 'Very angry, strong language'],
    },
    is_urgent: {
      type: 'noul',
      instructions: 'Is this urgent?',
    },
  },
};

const RESULT: RunResult = {
  answers: {
    department: {
      type: 'choice',
      choice: 'technical',
      confidence: 0.75,
      probabilities: { technical: 0.84, sales: 0.0, billing: 0.16 },
    },
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
    is_urgent: {
      type: 'noul',
      noul: 0.99,
    },
  },
  model: 'jev-1.13.0',
  usage: { inputTokens: 425, outputTokens: 73 },
  latencyMs: 894.2,
  costUsd: 0.00001785,
};

const WIDTH = 72;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('ResultsView', () => {
  it('shows the empty-state hint when there is no result and nothing is running', () => {
    const { lastFrame } = render(
      <ResultsView
        request={REQUEST}
        result={undefined}
        stale={false}
        running={false}
        selectedId={undefined}
        width={WIDTH}
        color={true}
      />,
    );
    expect(lastFrame()).toContain('Run the request (r) to see answers here.');
  });

  it('renders the choice block with bars and probability-descending order', () => {
    const { lastFrame } = render(
      <ResultsView
        request={REQUEST}
        result={RESULT}
        stale={false}
        running={false}
        selectedId={undefined}
        width={WIDTH}
        color={true}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('technical');
    expect(frame).toContain('0.84');
    expect(frame).toMatch(/█+/);

    const plain = stripAnsi(frame);
    const iTechnical = plain.indexOf('technical');
    const iBilling = plain.indexOf('billing');
    const iSales = plain.indexOf('sales');
    expect(iTechnical).toBeGreaterThanOrEqual(0);
    expect(iBilling).toBeGreaterThan(iTechnical);
    expect(iSales).toBeGreaterThan(iBilling);
  });

  it('marks low confidence with a bang and leaves high confidence unmarked', () => {
    const { lastFrame } = render(
      <ResultsView
        request={REQUEST}
        result={RESULT}
        stale={false}
        running={false}
        selectedId={undefined}
        width={WIDTH}
        color={true}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('conf 0.75 !');
    expect(frame).toContain('conf 1.00');
    expect(frame).not.toContain('conf 1.00 !');
  });

  it('renders the score scale with a marker and the nearest legend text', () => {
    const { lastFrame } = render(
      <ResultsView
        request={REQUEST}
        result={RESULT}
        stale={false}
        running={false}
        selectedId={undefined}
        width={WIDTH}
        color={true}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('●');
    expect(frame).toContain('Frustrated but civil');
  });

  it('renders the noul block with P(yes), the value, and the yes/no word', () => {
    const { lastFrame } = render(
      <ResultsView
        request={REQUEST}
        result={RESULT}
        stale={false}
        running={false}
        selectedId={undefined}
        width={WIDTH}
        color={true}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('P(yes)');
    expect(frame).toContain('0.99');
    expect(frame).toContain('yes');
  });

  it('orders blocks by request order even when the answers object is ordered differently', () => {
    const reorderedResult: RunResult = {
      ...RESULT,
      answers: {
        is_urgent: RESULT.answers.is_urgent!,
        frustration: RESULT.answers.frustration!,
        department: RESULT.answers.department!,
      },
    };
    const { lastFrame } = render(
      <ResultsView
        request={REQUEST}
        result={reorderedResult}
        stale={false}
        running={false}
        selectedId={undefined}
        width={WIDTH}
        color={true}
      />,
    );
    const plain = stripAnsi(lastFrame() ?? '');
    const iDepartment = plain.indexOf('CHOICE department');
    const iFrustration = plain.indexOf('SCORE frustration');
    const iUrgent = plain.indexOf('NOUL is_urgent');
    expect(iDepartment).toBeGreaterThanOrEqual(0);
    expect(iFrustration).toBeGreaterThan(iDepartment);
    expect(iUrgent).toBeGreaterThan(iFrustration);
  });

  it('drops an answer for a question that no longer exists in the request', () => {
    const smallerRequest: Request = {
      ...REQUEST,
      questions: {
        department: REQUEST.questions.department!,
        is_urgent: REQUEST.questions.is_urgent!,
      },
    };
    const { lastFrame } = render(
      <ResultsView
        request={smallerRequest}
        result={RESULT}
        stale={false}
        running={false}
        selectedId={undefined}
        width={WIDTH}
        color={true}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('SCORE frustration');
  });

  it('shows the stale banner when the request has changed since the run', () => {
    const { lastFrame } = render(
      <ResultsView
        request={REQUEST}
        result={RESULT}
        stale={true}
        running={false}
        selectedId={undefined}
        width={WIDTH}
        color={true}
      />,
    );
    expect(lastFrame()).toContain('stale — request changed');
  });

  it('shows a running indicator while a run is in flight', () => {
    const { lastFrame } = render(
      <ResultsView
        request={REQUEST}
        result={undefined}
        stale={false}
        running={true}
        selectedId={undefined}
        width={WIDTH}
        color={true}
      />,
    );
    expect(lastFrame()).toContain('Running…');
  });

  it('prefixes the selected block header with a pointer', () => {
    const { lastFrame } = render(
      <ResultsView
        request={REQUEST}
        result={RESULT}
        stale={false}
        running={false}
        selectedId="department"
        width={WIDTH}
        color={true}
      />,
    );
    const plain = stripAnsi(lastFrame() ?? '');
    const lines = plain.split('\n');
    const headerLine = lines.find((l) => l.includes('CHOICE department'));
    expect(headerLine?.trimStart().startsWith('▸ ')).toBe(true);
  });

  it('emits no ESC characters when color is false', () => {
    const { lastFrame } = render(
      <ResultsView
        request={REQUEST}
        result={RESULT}
        stale={true}
        running={false}
        selectedId="department"
        width={WIDTH}
        color={false}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/\x1b/);
  });

  it('wraps every line to fit within the given width', () => {
    const { lastFrame } = render(
      <ResultsView
        request={REQUEST}
        result={RESULT}
        stale={false}
        running={false}
        selectedId={undefined}
        width={40}
        color={true}
      />,
    );
    const plain = stripAnsi(lastFrame() ?? '');
    for (const line of plain.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });
});

describe('StatusLine', () => {
  it('shows the key-not-configured hint, which takes precedence', () => {
    const { lastFrame } = render(<StatusLine result={undefined} keyConfigured={false} />);
    expect(lastFrame()).toContain('TYPESAFE_API_KEY is not set — editing works, run is disabled');
  });

  it('shows "ready" when configured but no result yet', () => {
    const { lastFrame } = render(<StatusLine result={undefined} keyConfigured={true} />);
    expect(lastFrame()).toBe('ready');
  });

  it('shows model, latency, tokens, and cost when a result exists', () => {
    const { lastFrame } = render(<StatusLine result={RESULT} keyConfigured={true} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('jev-1.13.0');
    expect(frame).toContain('894 ms');
    expect(frame).toContain('425 tok');
    expect(frame).toContain('$0.000018');
  });
});
