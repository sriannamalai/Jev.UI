import type { Request } from '@jev-ui/core';
import { render } from 'ink-testing-library';
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { Frame, QuestionsView, StateView } from '../src/tui/Panes.js';

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('StateView with CJK state text', () => {
  const request: Request = {
    state: '顧客からの問い合わせが届きました。至急対応が必要です。長い日本語のテキストが続きます。',
    questions: {},
  };

  it('wraps every line to fit within the given DISPLAY width', () => {
    const { lastFrame } = render(<StateView request={request} width={36} />);
    const plain = stripAnsi(lastFrame() ?? '');
    for (const line of plain.split('\n')) {
      expect(stringWidth(line)).toBeLessThanOrEqual(36);
    }
  });

  it('bounds its rows and makes wrapped state reachable with End even without color', async () => {
    const longRequest: Request = {
      state: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda',
      questions: {},
    };
    const { lastFrame, stdin } = render(
      <StateView request={longRequest} width={18} height={4} active={true} />,
    );
    let plain = stripAnsi(lastFrame() ?? '');
    expect(plain.split('\n')).toHaveLength(4);
    expect(plain).toContain('model:');
    expect(plain).toContain('↕');
    expect(plain).not.toContain('tokens');

    stdin.write('\u001B[F');
    await tick();
    plain = stripAnsi(lastFrame() ?? '');
    expect(plain.split('\n')).toHaveLength(4);
    expect(plain).toContain('32,000');
    expect(plain).toContain('↕');
    expect(plain).not.toMatch(/\x1b/);
  });

  it('renders no rows at height zero and keeps height-one content scrollable', async () => {
    const request: Request = { state: 'one\ntwo\nthree', questions: {} };
    const zero = render(<StateView request={request} width={40} height={0} active />);
    expect(zero.lastFrame() ?? '').toBe('');
    zero.unmount();

    const one = render(<StateView request={request} width={40} height={1} active />);
    expect((one.lastFrame() ?? '').split('\n')).toEqual(['model: jev-latest']);
    one.stdin.write('\u001B[F');
    await tick();
    const bottom = stripAnsi(one.lastFrame() ?? '');
    expect(bottom.split('\n')).toHaveLength(1);
    expect(bottom).toContain('tokens');
    expect(bottom).not.toContain('↕');
  });
});

describe('QuestionsView with CJK instructions', () => {
  const request: Request = {
    state: 'state',
    questions: {
      department: {
        type: 'choice',
        instructions: '長い日本語の指示文がここに入りますので折り返しを確認します',
        criteria: { 技術部門: null, 営業部門: null },
      },
    },
  };

  it('wraps every line, including indented detail lines, to fit within the given DISPLAY width', () => {
    const { lastFrame } = render(
      <QuestionsView request={request} selectedId="department" width={36} color={true} />,
    );
    const plain = stripAnsi(lastFrame() ?? '');
    for (const line of plain.split('\n')) {
      expect(stringWidth(line)).toBeLessThanOrEqual(36);
    }
  });

  it('automatically scrolls the selected question into a bounded viewport', async () => {
    const requestWithManyQuestions: Request = {
      state: 'state',
      questions: Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [
          `question_${index + 1}`,
          { type: 'noul' as const, instructions: `Instruction ${index + 1}` },
        ]),
      ),
    };
    const view = render(
      <QuestionsView
        request={requestWithManyQuestions}
        selectedId="question_8"
        width={30}
        color={false}
        height={5}
      />,
    );
    await tick();
    const plain = stripAnsi(view.lastFrame() ?? '');
    expect(plain.split('\n')).toHaveLength(5);
    expect(plain).toContain('question_8');
    expect(plain).toContain('↕');
    expect(plain).not.toMatch(/\x1b/);
  });

  it('uses PageDown, Home, and End to request a visible selection change', async () => {
    const requestWithManyQuestions: Request = {
      state: 'state',
      questions: Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [
          `question_${index + 1}`,
          { type: 'noul' as const, instructions: `Instruction ${index + 1}` },
        ]),
      ),
    };
    const selections: string[] = [];
    const { stdin } = render(
      <QuestionsView
        request={requestWithManyQuestions}
        selectedId="question_1"
        width={30}
        color={false}
        height={5}
        active={true}
        onSelect={(id) => selections.push(id)}
      />,
    );

    stdin.write('\u001B[6~');
    await tick();
    stdin.write('\u001B[F');
    await tick();
    stdin.write('\u001B[H');
    await tick();

    expect(selections[0]).toBe('question_3');
    expect(selections).toContain('question_8');
    expect(selections.at(-1)).toBe('question_1');
  });

  it('pages through every detail row of a long selected question before changing selection', async () => {
    const criteria = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`option_${index + 1}`, `Description ${index + 1}`]),
    );
    const requestWithLongQuestion: Request = {
      state: 'state',
      questions: {
        long_question: {
          type: 'choice',
          instructions: 'Choose one',
          criteria,
        },
      },
    };
    const { lastFrame, stdin } = render(
      <QuestionsView
        request={requestWithLongQuestion}
        selectedId="long_question"
        width={32}
        color={false}
        height={6}
        active={true}
        onSelect={() => undefined}
      />,
    );

    for (let page = 0; page < 10; page += 1) {
      stdin.write('\u001B[6~');
      await tick();
    }

    expect(stripAnsi(lastFrame() ?? '')).toContain('option_40 — Description 40');
  });

  it('selects the next question after an exact page multiple of expanded details', async () => {
    const criteria = Object.fromEntries(
      Array.from({ length: 38 }, (_, index) => [`option_${index + 1}`, null]),
    );
    const selections: string[] = [];
    const { stdin } = render(
      <QuestionsView
        request={{
          state: 'state',
          questions: {
            long_question: { type: 'choice', instructions: 'Choose one', criteria },
            next_question: { type: 'noul', instructions: 'Next' },
            last_question: { type: 'noul', instructions: 'Last' },
          },
        }}
        selectedId="long_question"
        width={40}
        color={false}
        height={6}
        active
        onSelect={(id) => selections.push(id)}
      />,
    );

    for (let page = 0; page < 8; page += 1) {
      stdin.write('\u001B[6~');
      await tick();
    }

    expect(selections).toEqual(['next_question']);
  });
});

describe('Frame height', () => {
  it('treats height as the total bordered height and clips overflowing children', () => {
    const { lastFrame } = render(
      <Frame title="TEST" focused={false} width={20} height={5} color={false}>
        <StateView request={{ state: 'one\ntwo\nthree\nfour', questions: {} }} width={18} />
      </Frame>,
    );
    expect((lastFrame() ?? '').split('\n')).toHaveLength(5);
  });

  it('keeps a long title inside a very narrow frame', () => {
    const { lastFrame } = render(
      <Frame title="A VERY LONG TITLE" focused={true} width={8} height={4} color={false} />,
    );
    for (const line of (lastFrame() ?? '').split('\n')) {
      expect(stringWidth(line)).toBeLessThanOrEqual(8);
    }
  });
});
