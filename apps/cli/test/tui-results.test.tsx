import { vi } from 'vitest';

// Ink's `dimColor` goes through chalk, which auto-detects terminal color
// support from `process.stdout`/env at import time. The test runner's stdout
// isn't a TTY, so chalk would otherwise render no ANSI codes at all —
// `vi.hoisted` runs this above the `ink`/chalk imports below so the "with
// color: true" test can assert on the real dim SGR sequence.
vi.hoisted(() => {
  process.env.FORCE_COLOR = '1';
});

import type { Request, RunResult } from '@jev-ui/core';
import { render } from 'ink-testing-library';
import stringWidth from 'string-width';
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

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('renders nothing for a question named after a prototype member with no answer', () => {
    const request: Request = {
      state: 'A customer wrote in.',
      questions: { constructor: { type: 'noul' as const, instructions: 'Is this urgent?' } },
    };
    const result: RunResult = {
      answers: {},
      model: 'jev-1.13.0',
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 1,
      costUsd: 0,
    };
    const { lastFrame } = render(
      <ResultsView
        request={request}
        result={result}
        stale={false}
        running={false}
        selectedId={undefined}
        width={WIDTH}
        color={false}
      />,
    );
    expect(lastFrame() ?? '').not.toContain('constructor');
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

  it('dims the stale banner when color is enabled', () => {
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
    const frame = lastFrame() ?? '';
    const staleLine = frame.split('\n').find((line) => line.includes('stale — request changed'));
    expect(staleLine).toContain('\u001b[2m');
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

  it('wraps every line to fit within the given DISPLAY width, with CJK option keys and emoji legend text', () => {
    const wideRequest: Request = {
      ...REQUEST,
      questions: {
        department: {
          type: 'choice',
          // Deliberately unequal option-key lengths (2 vs. 5 characters): a
          // `.length`-based label column visibly misaligns the bars across
          // rows here, while a DISPLAY-width-based one keeps them flush.
          instructions: 'Which department?',
          criteria: { 技術: null, 営業部門課: null, 請求: null },
        },
        frustration: REQUEST.questions.frustration!,
      },
    };
    const wideResult: RunResult = {
      ...RESULT,
      answers: {
        department: {
          type: 'choice',
          choice: '技術',
          confidence: 0.75,
          probabilities: { 技術: 0.84, 営業部門課: 0.0, 請求: 0.16 },
        },
        frustration: {
          type: 'score',
          score: 1.0,
          confidence: 1.0,
          legend: {
            '0': '😌 calm',
            '1': '😐 frustrated but civil',
            '2': '😡 very angry',
          },
          probabilities: { '0': 0, '1': 1, '2': 0 },
        },
      },
    };
    const { lastFrame } = render(
      <ResultsView
        request={wideRequest}
        result={wideResult}
        stale={false}
        running={false}
        selectedId={undefined}
        width={40}
        color={true}
      />,
    );
    const plain = stripAnsi(lastFrame() ?? '');
    const lines = plain.split('\n');
    for (const line of lines) {
      expect(stringWidth(line)).toBeLessThanOrEqual(40);
    }
    // Label columns stay aligned within a block: every bar row in the
    // CHOICE block starts at the same display column.
    const choiceStart = lines.findIndex((line) => line.includes('CHOICE department'));
    const scoreStart = lines.findIndex((line) => line.includes('SCORE frustration'));
    const choiceBlockLines = lines.slice(choiceStart + 1, scoreStart);
    const barStarts = choiceBlockLines
      .filter((line) => /[█░]/.test(line))
      .map((line) => stringWidth(line.slice(0, line.search(/[█░]/))));
    expect(barStarts.length).toBeGreaterThan(0);
    expect(new Set(barStarts).size).toBe(1);
  });

  it('bounds result rows and makes later answer details reachable with End', async () => {
    const { lastFrame, stdin } = render(
      <ResultsView
        request={REQUEST}
        result={RESULT}
        stale={true}
        running={false}
        selectedId={undefined}
        width={40}
        color={false}
        height={6}
        active={true}
      />,
    );
    let plain = stripAnsi(lastFrame() ?? '');
    expect(plain.split('\n')).toHaveLength(6);
    expect(plain).toContain('stale — request changed');
    expect(plain).toContain('CHOICE department');
    expect(plain).toContain('↕');
    expect(plain).not.toContain('NOUL is_urgent');

    stdin.write('\u001B[F');
    await tick();
    plain = stripAnsi(lastFrame() ?? '');
    expect(plain.split('\n')).toHaveLength(6);
    expect(plain).toContain('NOUL is_urgent');
    expect(plain).toContain('0.99');
    expect(plain).toContain('↕');
    expect(plain).not.toMatch(/\x1b/);
  });

  it.each(Array.from({ length: 9 }, (_, index) => index + 1))(
    'uses scrollable rows to preserve labels and numeric probabilities at width %i',
    async (width) => {
      const narrowRequest: Request = {
        state: 'state',
        questions: {
          q: { type: 'choice', instructions: 'Pick', criteria: { 'probability-label': null } },
        },
      };
      const narrowResult: RunResult = {
        ...RESULT,
        answers: {
          q: {
            type: 'choice',
            choice: 'chosen',
            confidence: 1,
            probabilities: { 'probability-label': 0.37 },
          },
        },
      };

      const { lastFrame, stdin, unmount } = render(
        <ResultsView
          request={narrowRequest}
          result={narrowResult}
          stale={false}
          running={false}
          selectedId={undefined}
          width={width}
          color={false}
          height={3}
          active
        />,
      );
      let revealed = '';
      for (let step = 0; step < 80; step += 1) {
        const before = lastFrame() ?? '';
        const plain = stripAnsi(before);
        const lines = plain.split('\n');
        for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(width);
        revealed += lines.at(-2) ?? '';
        stdin.write('\u001B[B');
        await tick();
        if ((lastFrame() ?? '') === before) break;
      }
      expect(revealed).toContain('probability-label');
      expect(revealed).toContain('0.37');
      unmount();
    },
  );

  it('preserves narrow CJK probability labels without overflowing', () => {
    const narrowRequest: Request = {
      state: 'state',
      questions: {
        q: { type: 'choice', instructions: 'Pick', criteria: { 技術部門: null } },
      },
    };
    const narrowResult: RunResult = {
      ...RESULT,
      answers: {
        q: {
          type: 'choice',
          choice: '技術部門',
          confidence: 0.84,
          probabilities: { 技術部門: 0.84 },
        },
      },
    };
    const { lastFrame } = render(
      <ResultsView
        request={narrowRequest}
        result={narrowResult}
        stale={false}
        running={false}
        selectedId={undefined}
        width={1}
        color={false}
      />,
    );
    const plain = stripAnsi(lastFrame() ?? '');
    for (const line of plain.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(1);
    expect(plain.replaceAll('\n', '')).toContain('\\u{6280}\\u{8853}\\u{90e8}\\u{9580}');
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
