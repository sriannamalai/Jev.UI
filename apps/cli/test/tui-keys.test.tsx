import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryStore, Request, RunResult, SetsStore } from '@jev-ui/core';
import { App } from '../src/tui/App.js';
import type { TuiDeps } from '../src/tui/App.js';

// Full-App integration tests for slice 14a's editing keys (a/d/D/J/K/Enter/
// n/i/m). The pure round-trip/validation rules for choice/score criteria
// live in tui-question-edit.test.ts; the prompt widgets' own key handling
// lives in tui-prompts.test.tsx. This file exercises them wired into `App`.

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

const ONE_QUESTION_REQUEST: Request = {
  state: 'hello',
  questions: {
    only_one: { type: 'noul', instructions: 'The only question' },
  },
};

const RESULT: RunResult = {
  answers: {},
  model: 'jev-1.13.0',
  usage: { inputTokens: 1, outputTokens: 1 },
  latencyMs: 1,
  costUsd: 0,
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
    ...overrides,
  };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function escapeTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

async function backspace(stdin: { write(s: string): void }, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    stdin.write('\u007f');
    await tick();
  }
}

describe('add / delete / duplicate / reorder', () => {
  it('a then s adds a score question, selects it, and focuses Questions', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={ONE_QUESTION_REQUEST} />);
    stdin.write('a');
    await tick();
    stdin.write('s');
    await tick();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▸ \[score] score_1/);
    const questionsLine = frame.split('\n').find((l) => l.includes('QUESTIONS'));
    expect(questionsLine?.includes('▌')).toBe(true);
  });

  it('d on the only question shows a notice and keeps it', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={ONE_QUESTION_REQUEST} />);
    stdin.write('d');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('A request needs at least one question');
    expect(frame).toContain('only_one');
  });

  it('J moves the selected question down, K moves it back up', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('J');
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame.indexOf('frustration')).toBeLessThan(frame.indexOf('department'));

    stdin.write('K');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame.indexOf('department')).toBeLessThan(frame.indexOf('frustration'));
  });

  it('D duplicates the selected question', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('D');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('department_copy');
  });
});

describe('rename (n)', () => {
  it('rejects a duplicate id, then renames and follows the selection', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('n');
    await tick();
    await backspace(stdin, 'department'.length);
    stdin.write('frustration');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toContain('A question with this id already exists');

    await backspace(stdin, 'frustration'.length);
    stdin.write('dept');
    await tick();
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▸ [choice] dept');
  });
});

describe('Enter edits the selected question', () => {
  it('noul: instructions, then Yes means, Esc on No means keeps only criteria.true', async () => {
    const deps = makeDeps({ columns: 140 });
    const { stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('2'); // focus Questions
    await tick();
    stdin.write('j'); // frustration
    await tick();
    stdin.write('j'); // is_urgent
    await tick();
    stdin.write('\r'); // Enter -> Instructions prompt
    await tick();
    await backspace(stdin, 'Is this urgent?'.length);
    stdin.write('New instructions');
    await tick();
    stdin.write('\r'); // commit instructions -> Yes means prompt
    await tick();
    stdin.write('Yes means this');
    await tick();
    stdin.write('\r'); // commit yes -> No means prompt
    await tick();
    stdin.write('\u001B'); // Esc cancels the rest
    await escapeTick();

    stdin.write('r');
    await tick();
    await tick();
    expect(deps.run).toHaveBeenCalledTimes(1);
    const sent = (deps.run as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Request;
    expect(sent.questions.is_urgent).toEqual({
      type: 'noul',
      instructions: 'New instructions',
      criteria: { true: 'Yes means this' },
    });
  });

  it('choice: LinesPrompt is prefilled with key: description lines', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('2');
    await tick();
    stdin.write('\r'); // Enter on department -> Instructions prompt
    await tick();
    stdin.write('\r'); // commit unchanged -> Options prompt
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('technical:');
    expect(frame).toContain('sales:');
    expect(frame).toContain('billing:');
  });

  it('choice: editing options and Ctrl+S updates criteria in order', async () => {
    const deps = makeDeps({ columns: 140 });
    const { stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('2');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('\r'); // -> Options prompt, cursor at end of first line ('technical:')
    await tick();
    stdin.write(' A tech issue');
    await tick();
    stdin.write('\u0013'); // Ctrl+S
    await tick();

    stdin.write('r');
    await tick();
    await tick();
    const sent = (deps.run as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Request;
    expect(sent.questions.department).toEqual({
      type: 'choice',
      instructions: 'Which department?',
      criteria: { technical: 'A tech issue', sales: null, billing: null },
    });
  });

  it('choice: an invalid options buffer (duplicate key) shows the message and stays open', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('2');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('\r'); // -> Options prompt: line 0 'technical:', line 1 'sales:', line 2 'billing:'
    await tick();
    stdin.write('\u001B[B'); // down to 'sales:'
    await tick();
    await backspace(stdin, 'sales:'.length);
    stdin.write('technical:');
    await tick();
    stdin.write('\u0013'); // Ctrl+S -> should fail: duplicate key
    await tick();
    expect(lastFrame() ?? '').toContain('Duplicate option key: technical');
    expect(deps.run).not.toHaveBeenCalled();
  });
});

describe('model (m) and state (i)', () => {
  it('m sets the model, shown in the State pane header', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('m');
    await tick();
    await backspace(stdin, 20);
    stdin.write('jev-1.13.0');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toContain('model: jev-1.13.0');
  });

  it('i sets a single-line state; a JSON object becomes structured state', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('i');
    await tick();
    await backspace(stdin, 30);
    stdin.write('New state line');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toContain('New state line');

    stdin.write('i');
    await tick();
    await backspace(stdin, 30);
    stdin.write('{"a":1}');
    await tick();
    stdin.write('\r');
    await tick();

    stdin.write('i');
    await tick();
    expect(lastFrame() ?? '').toContain(
      'State is multi-line or structured — press E to edit it in your editor',
    );
  });
});

describe('prompt mode swallows single-letter commands', () => {
  it('typing r inside the model prompt inserts the letter and does not run; q does not exit', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('m');
    await tick();
    stdin.write('r');
    await tick();
    expect(lastFrame() ?? '').toContain('Enter save · Esc cancel');
    expect(deps.run).not.toHaveBeenCalled();

    stdin.write('q');
    await tick();
    expect(lastFrame() ?? '').toContain('Enter save · Esc cancel');

    stdin.write('\u001B');
    await escapeTick();
    stdin.write('r');
    await tick();
    await tick();
    expect(deps.run).toHaveBeenCalledTimes(1);
  });
});
