import type { Request } from '@jev-ui/core';
import { render } from 'ink-testing-library';
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { QuestionsView, StateView } from '../src/tui/Panes.js';

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
});
