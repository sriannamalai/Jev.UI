import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { JevError } from '@jev-ui/core';
import type { HistoryStore, Request, RunResult, SetsStore } from '@jev-ui/core';
import { App } from '../src/tui/App.js';
import type { TuiDeps } from '../src/tui/App.js';

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

function fakeSets(): SetsStore {
  return {
    dir: '/sets',
    list: vi.fn(async () => []),
    load: vi.fn(async () => {
      throw new Error('unused');
    }),
    save: vi.fn(async () => undefined),
  };
}

function fakeHistory(): HistoryStore {
  return {
    file: '/history.jsonl',
    append: vi.fn(async () => undefined),
    recent: vi.fn(async () => []),
  };
}

function makeDeps(overrides: Partial<TuiDeps> = {}): TuiDeps {
  return {
    run: vi.fn(async () => RESULT),
    listModels: vi.fn(async () => []),
    sets: fakeSets(),
    history: fakeHistory(),
    keyConfigured: true,
    openEditor: vi.fn(async () => ''),
    writeFile: vi.fn(async () => undefined),
    fileExists: vi.fn(async () => false),
    cwd: vi.fn(() => '/cwd'),
    ...overrides,
  };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// A lone Esc byte is disambiguated from the start of a longer escape
// sequence (e.g. an arrow key) with a short timeout internal to Ink's input
// parser, so tests that send Esc need to wait longer than a single tick.
async function escapeTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('App layout', () => {
  it('shows all three pane titles side by side when wide', () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame } = render(<App deps={deps} initial={REQUEST} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('STATE');
    expect(frame).toContain('QUESTIONS');
    expect(frame).toContain('RESULTS');
  });

  it('shows a tab strip and only the State pane when narrow', () => {
    const deps = makeDeps({ columns: 90 });
    const { lastFrame } = render(<App deps={deps} initial={REQUEST} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[State]');
    expect(frame).toContain('STATE');
    expect(frame).not.toContain('QUESTIONS');
    expect(frame).not.toContain('RESULTS');
  });

  it('fits every line within columns, wide', () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame } = render(<App deps={deps} initial={REQUEST} />);
    const plain = stripAnsi(lastFrame() ?? '');
    for (const line of plain.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(140);
    }
  });

  it('fits every line within columns, narrow', () => {
    const deps = makeDeps({ columns: 90 });
    const { lastFrame } = render(<App deps={deps} initial={REQUEST} />);
    const plain = stripAnsi(lastFrame() ?? '');
    for (const line of plain.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(90);
    }
  });

  it('emits no ESC characters when NO_COLOR is set', () => {
    const deps = makeDeps({ columns: 140, env: { NO_COLOR: '1' } });
    const { lastFrame } = render(<App deps={deps} initial={REQUEST} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/\x1b/);
  });
});

describe('App focus and selection', () => {
  it('moves focus on Tab, highlighting the new pane title', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('\t');
    await tick();
    const plain = stripAnsi(lastFrame() ?? '');
    const questionsLine = plain.split('\n').find((l) => l.includes('QUESTIONS'));
    expect(questionsLine?.includes('▌')).toBe(true);
  });

  it('swaps the visible pane on Tab when narrow', async () => {
    const deps = makeDeps({ columns: 90 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('\t');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[Questions]');
    expect(frame).toContain('QUESTIONS');
    expect(frame).not.toContain('STATE');
  });

  it('jumps to Results on 3', async () => {
    const deps = makeDeps({ columns: 90 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('3');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[Results]');
    expect(frame).toContain('RESULTS');
  });

  it('selects the second question with the Questions pane focused, and clamps at the end', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('2'); // focus Questions
    await tick();
    stdin.write('\u001B[B'); // down arrow
    await tick();
    let plain = stripAnsi(lastFrame() ?? '');
    expect(plain).toContain('▸ [score] frustration');
    expect(plain).toContain('Frustrated but civil');

    stdin.write('\u001B[B');
    await tick();
    stdin.write('\u001B[B'); // one past the end — clamped
    await tick();
    plain = stripAnsi(lastFrame() ?? '');
    expect(plain).toContain('▸ [noul] is_urgent');
  });
});

describe('App run', () => {
  it('runs on r and renders the result plus the footer', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('r');
    await tick();
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('technical');
    expect(frame).toContain('0.84');
    expect(frame).toMatch(/█+/);
    expect(frame).toContain('jev-1.13.0');
  });

  it('calls deps.run with exactly the request', async () => {
    const deps = makeDeps({ columns: 140 });
    const { stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('r');
    await tick();
    await tick();
    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(deps.run).toHaveBeenCalledWith(REQUEST);
  });

  it('ignores a second r while a run is in flight', async () => {
    let resolveRun: (r: RunResult) => void = () => undefined;
    const deps = makeDeps({
      columns: 140,
      run: vi.fn(
        () =>
          new Promise<RunResult>((resolve) => {
            resolveRun = resolve;
          }),
      ),
    });
    const { stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('r');
    await tick();
    stdin.write('r');
    await tick();
    resolveRun(RESULT);
    await tick();
    expect(deps.run).toHaveBeenCalledTimes(1);
  });

  it('shows a JevError from a rejected run', async () => {
    const deps = makeDeps({
      columns: 140,
      run: vi.fn(async () => {
        throw new JevError('validation', 'bad', { path: 'questions.q.criteria' });
      }),
    });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('r');
    await tick();
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✕ validation: bad at questions.q.criteria');
  });

  it('names the question that still needs instructions or criteria', async () => {
    const deps = makeDeps({ columns: 140 });
    const blank: Request = {
      state: 'A customer wrote in.',
      questions: { is_urgent: { type: 'noul', instructions: '' } },
    };
    const { lastFrame, stdin } = render(<App deps={deps} initial={blank} />);
    stdin.write('r');
    await tick();
    expect(deps.run).not.toHaveBeenCalled();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Add instructions or criteria to "is_urgent"');
  });

  it('does not call run when the key is not configured, and shows the key hint in the footer', async () => {
    const deps = makeDeps({ columns: 140, keyConfigured: false });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    expect(lastFrame()).toContain('TYPESAFE_API_KEY is not set');
    stdin.write('r');
    await tick();
    expect(deps.run).not.toHaveBeenCalled();
  });
});

describe('App help overlay', () => {
  it('shows every KEYMAP entry on ? and hides it on Esc', async () => {
    const { KEYMAP } = await import('../src/tui/keys.js');
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('?');
    await tick();
    let frame = lastFrame() ?? '';
    for (const [key, description] of Object.entries(KEYMAP)) {
      expect(frame).toContain(key);
      expect(frame).toContain(description);
    }

    stdin.write('\u001B'); // Esc
    await escapeTick();
    frame = lastFrame() ?? '';
    expect(frame).toContain('STATE');
  });
});

describe('App exit', () => {
  it('exits on q, tearing the app down so later input is ignored', async () => {
    const deps = makeDeps({ columns: 140 });
    const { stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('q');
    await tick();
    stdin.write('r');
    await tick();
    expect(deps.run).not.toHaveBeenCalled();
  });
});
