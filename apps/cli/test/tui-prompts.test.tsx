import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ChoicePrompt, LinesPrompt, ListPrompt, TextPrompt } from '../src/tui/Prompts.js';
import { displayWidth } from '../src/tui/bars.js';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

const FAMILY = '\u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function escapeTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
}

describe('TextPrompt', () => {
  it('normalizes pasted newlines so they cannot break the prompt row', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<TextPrompt label="X" onSubmit={onSubmit} onCancel={vi.fn()} />);
    stdin.write('one\r\ntwo\nthree');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('one two three');
  });

  it('renders bounded context, progress, and the requested submit label', async () => {
    const { lastFrame } = render(
      <TextPrompt
        label="Instructions"
        context="Question with a very long identifier"
        progress={{ current: 1, total: 2 }}
        submitLabel="Next"
        width={20}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Step 1/2');
    expect(frame).toContain('Enter Next');
    for (const line of frame.split('\n')) expect(displayWidth(line)).toBeLessThanOrEqual(20);
  });

  it('keeps the input row reachable when height is only one row', async () => {
    const { lastFrame, stdin } = render(
      <TextPrompt
        label="Name"
        context="Hidden context"
        progress={{ current: 1, total: 2 }}
        height={1}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    stdin.write('x');
    await tick();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame.split('\n')).toHaveLength(1);
    expect(frame).toContain('Name: x');
  });

  it('renders nothing at height zero', () => {
    const { lastFrame } = render(
      <TextPrompt label="Name" height={0} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(lastFrame() ?? '').toBe('');
  });

  it('renders the label and typed characters', async () => {
    const { lastFrame, stdin } = render(
      <TextPrompt label="Instructions" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    stdin.write('hi');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Instructions');
    expect(frame).toContain('hi');
  });

  it('backspace removes the last character', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<TextPrompt label="X" onSubmit={onSubmit} onCancel={vi.fn()} />);
    stdin.write('abc');
    await tick();
    stdin.write('\u007f'); // backspace
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('ab');
  });

  it('left arrow then insert places the character in the middle', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<TextPrompt label="X" onSubmit={onSubmit} onCancel={vi.fn()} />);
    stdin.write('ac');
    await tick();
    stdin.write('\u001B[D'); // left arrow
    await tick();
    stdin.write('b');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('abc');
  });

  it('Home and End move the cursor to the edges', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <TextPrompt label="X" initial="bc" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    stdin.write('\u0001'); // Ctrl+A -> Home
    await tick();
    stdin.write('a');
    await tick();
    stdin.write('\u0005'); // Ctrl+E -> End
    await tick();
    stdin.write('d');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('abcd');
  });

  it('Enter submits the current text', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<TextPrompt label="X" onSubmit={onSubmit} onCancel={vi.fn()} />);
    stdin.write('hello');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('hello');
  });

  it('Esc cancels without submitting', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = render(<TextPrompt label="X" onSubmit={onSubmit} onCancel={onCancel} />);
    stdin.write('hello');
    await tick();
    stdin.write('\u001B');
    await escapeTick();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a failing validate shows the message and stays open', async () => {
    const onSubmit = vi.fn();
    const validate = vi.fn(() => 'nope, try again');
    const { lastFrame, stdin } = render(
      <TextPrompt label="X" onSubmit={onSubmit} onCancel={vi.fn()} validate={validate} />,
    );
    stdin.write('bad');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').toContain('nope, try again');
  });

  it('moves the cursor by grapheme, not by code unit', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<TextPrompt label="X" onSubmit={onSubmit} onCancel={vi.fn()} />);
    stdin.write('日本語');
    await tick();
    stdin.write('\u001B[D'); // left arrow
    await tick();
    stdin.write('x');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('日本x語');
  });

  it('backspace deletes a whole grapheme cluster', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<TextPrompt label="X" onSubmit={onSubmit} onCancel={vi.fn()} />);
    stdin.write(`a${FAMILY}`);
    await tick();
    stdin.write('\u007f'); // backspace
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('a');
  });

  it('keeps every rendered line within the given display width, cursor visible', async () => {
    // 30 display columns, with a distinctive grapheme at each end.
    const value = `始${'日'.repeat(13)}端`;
    const { lastFrame, stdin } = render(
      <TextPrompt label="X" initial={value} width={20} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    await tick();
    const widthsFit = () => {
      for (const line of stripAnsi(lastFrame() ?? '').split('\n')) {
        expect(displayWidth(line)).toBeLessThanOrEqual(20);
      }
    };

    // The cursor starts at the end, so the window is scrolled to the tail.
    widthsFit();
    expect(stripAnsi(lastFrame() ?? '')).toContain('端');
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('始');

    stdin.write('\u0001'); // Ctrl+A -> Home
    await tick();
    widthsFit();
    expect(stripAnsi(lastFrame() ?? '')).toContain('始');
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('端');
  });

  it('renders a cursor marker without color', async () => {
    const { lastFrame } = render(
      <TextPrompt label="X" initial="abc" color={false} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).toContain('abc▏');
  });

  it('includes the plain cursor marker in its display-width budget', () => {
    const { lastFrame } = render(
      <TextPrompt
        label="Long label"
        initial="abcdef"
        width={4}
        height={1}
        color={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▏');
    expect(frame).not.toMatch(/\x1b/);
    expect(displayWidth(frame)).toBeLessThanOrEqual(4);
  });

  it('does not emit heading or footer ANSI when color is disabled', () => {
    const { lastFrame } = render(
      <TextPrompt
        label="Name"
        initial="value"
        context="Context"
        progress={{ current: 1, total: 2 }}
        color={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(lastFrame() ?? '').not.toMatch(/\x1b/);
  });
});

describe('LinesPrompt', () => {
  it('advances the cursor while typing sequential characters at the end of a line', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <LinesPrompt label="Body" initial={['a']} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    stdin.write('b');
    await tick();
    stdin.write('c');
    await tick();
    stdin.write('\u0013');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(['abc']);
  });

  it('advances the cursor while typing sequential characters in the middle of a line', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <LinesPrompt label="Body" initial={['ad']} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    stdin.write('\u001B[D');
    await tick();
    stdin.write('b');
    await tick();
    stdin.write('c');
    await tick();
    stdin.write('\u0013');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(['abcd']);
  });

  it('uses a one-column cursor fallback for a wide grapheme without changing the value', async () => {
    const onSubmit = vi.fn();
    const { lastFrame, stdin } = render(
      <LinesPrompt
        label="Body"
        initial={['界']}
        width={1}
        height={1}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    stdin.write('\u001B[D');
    await tick();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(displayWidth(frame)).toBeLessThanOrEqual(1);
    expect(frame).toContain('▏');
    stdin.write('\u0013');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(['界']);
  });

  it('never exceeds heights zero through four and keeps the editable row visible', () => {
    for (let height = 0; height <= 4; height += 1) {
      const view = render(
        <LinesPrompt
          label="Body"
          initial={['editable', 'second']}
          context="Context"
          progress={{ current: 1, total: 2 }}
          height={height}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const frame = stripAnsi(view.lastFrame() ?? '');
      expect(frame === '' ? 0 : frame.split('\n').length).toBeLessThanOrEqual(height);
      if (height > 0) expect(frame).toContain('editable');
      view.unmount();
    }
  });

  it('shows a plain cursor marker without ANSI and stays within width', () => {
    const { lastFrame } = render(
      <LinesPrompt
        label="L"
        initial={['abc']}
        width={3}
        color={false}
        height={1}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▏');
    expect(frame).not.toMatch(/\x1b/);
    expect(displayWidth(frame)).toBeLessThanOrEqual(3);
  });

  it('normalizes pasted newlines and preserves trailing blank lines', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <LinesPrompt label="Body" initial={['head']} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    stdin.write('one\r\ntwo\n\n');
    await tick();
    stdin.write('\u0013');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(['headone', 'two', '', '']);
  });

  it('bounds body rows by height and scrolls to keep the cursor visible', async () => {
    const { lastFrame, stdin } = render(
      <LinesPrompt
        label="Body"
        initial={['one', 'two', 'three', 'four', 'five', 'six']}
        height={5}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    for (let i = 0; i < 5; i += 1) {
      stdin.write('\u001B[B');
      await tick();
    }
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame.split('\n')).toHaveLength(5);
    expect(frame).toContain('six');
    expect(frame).not.toContain('one');
  });

  it('Enter creates a new line', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <LinesPrompt label="Options" initial={['a']} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    stdin.write('\r');
    await tick();
    stdin.write('b');
    await tick();
    stdin.write('\u0013'); // Ctrl+S
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(['a', 'b']);
  });

  it('Backspace at column 0 joins with the previous line', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <LinesPrompt label="Options" initial={['ab', 'cd']} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    stdin.write('\u001B[B'); // down to second line
    await tick();
    stdin.write('\u001B[D\u001B[D'); // left, left -> column 0 of 'cd'
    await tick();
    stdin.write('\u007f'); // backspace joins with previous
    await tick();
    stdin.write('\u0013');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(['abcd']);
  });

  it('up/down navigate between lines', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <LinesPrompt label="Options" initial={['a', 'b']} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    stdin.write('\u001B[B'); // down to 'b', cursor at end (col 1)
    await tick();
    stdin.write('x');
    await tick();
    stdin.write('\u0013');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(['a', 'bx']);
  });

  it('Ctrl+S submits without dropping trailing empty lines', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <LinesPrompt label="Options" initial={['a']} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    stdin.write('\r'); // new empty line below 'a'
    await tick();
    stdin.write('\u0013');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(['a', '']);
  });

  it('Esc cancels without submitting', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = render(
      <LinesPrompt label="Options" initial={['a']} onSubmit={onSubmit} onCancel={onCancel} />,
    );
    stdin.write('\u001B');
    await escapeTick();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a failing validate shows the message and stays open', async () => {
    const onSubmit = vi.fn();
    const validate = vi.fn(() => 'duplicate key');
    const { lastFrame, stdin } = render(
      <LinesPrompt
        label="Options"
        initial={['a']}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        validate={validate}
      />,
    );
    stdin.write('\u0013');
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').toContain('duplicate key');
  });

  it('moves and deletes by grapheme on the cursor row', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <LinesPrompt label="L" initial={[]} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    stdin.write(`日本語${FAMILY}`);
    await tick();
    stdin.write('\u007f'); // backspace removes the whole family cluster
    await tick();
    stdin.write('\u001B[D'); // left arrow
    await tick();
    stdin.write('x');
    await tick();
    stdin.write('\u0013'); // Ctrl+S
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(['日本x語']);
  });

  it('keeps the cursor row within the given display width, cursor visible', async () => {
    const value = `始${'日'.repeat(13)}端`; // 30 display columns
    const { lastFrame, stdin } = render(
      <LinesPrompt
        label="L"
        initial={[value, value]}
        width={20}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await tick();
    const widthsFit = () => {
      for (const line of stripAnsi(lastFrame() ?? '').split('\n')) {
        expect(displayWidth(line)).toBeLessThanOrEqual(20);
      }
    };

    // Row 0 holds the cursor (at the end of the line) and scrolls; row 1 is
    // truncated with an ellipsis.
    widthsFit();
    let rows = stripAnsi(lastFrame() ?? '').split('\n');
    expect(rows[1]).toContain('端');
    expect(rows[1]).not.toContain('…');
    expect(rows[2]).toContain('…');

    stdin.write('\u001B[D'.repeat(14)); // left to the first grapheme
    await tick();
    widthsFit();
    rows = stripAnsi(lastFrame() ?? '').split('\n');
    expect(rows[1]).toContain('始');
    expect(rows[1]).not.toContain('端');
  });
});

describe('ChoicePrompt', () => {
  it('bounds tiny heights and renders a plain selected marker without ANSI', () => {
    for (let height = 0; height <= 4; height += 1) {
      const view = render(
        <ChoicePrompt
          label="Pick"
          options={[
            { key: 'a', label: 'Alpha' },
            { key: 'b', label: 'Beta' },
          ]}
          context="Context"
          progress={{ current: 1, total: 2 }}
          width={12}
          height={height}
          color={false}
          onPick={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const frame = view.lastFrame() ?? '';
      expect(frame === '' ? 0 : stripAnsi(frame).split('\n').length).toBeLessThanOrEqual(height);
      expect(frame).not.toMatch(/\x1b/);
      if (height > 0) expect(frame).toContain('▸');
      view.unmount();
    }
  });

  it('uses the safe default on Enter and supports arrow navigation', async () => {
    const onPick = vi.fn();
    const { stdin } = render(
      <ChoicePrompt
        label="Delete question?"
        options={[
          { key: 'y', label: 'Yes' },
          { key: 'n', label: 'No' },
        ]}
        defaultKey="n"
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    stdin.write('\r');
    await tick();
    expect(onPick).toHaveBeenLastCalledWith('n');

    stdin.write('\u001B[A');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onPick).toHaveBeenLastCalledWith('y');
  });

  it('picks an option by its key', async () => {
    const onPick = vi.fn();
    const { lastFrame, stdin } = render(
      <ChoicePrompt
        label="Add question"
        options={[
          { key: 'n', label: 'Noul' },
          { key: 'c', label: 'Choice' },
          { key: 's', label: 'Score' },
        ]}
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    expect(lastFrame() ?? '').toContain('Noul');
    stdin.write('c');
    await tick();
    expect(onPick).toHaveBeenCalledWith('c');
  });

  it('Esc cancels', async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <ChoicePrompt
        label="Add question"
        options={[{ key: 'n', label: 'Noul' }]}
        onPick={vi.fn()}
        onCancel={onCancel}
      />,
    );
    stdin.write('\u001B');
    await escapeTick();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('ListPrompt', () => {
  it('does not emit inverse ANSI for the selected row when color is disabled', () => {
    const previousForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '1';
    try {
      const { lastFrame, unmount } = render(
        <ListPrompt
          label="Pick"
          items={[{ key: 'a', label: 'Alpha' }]}
          color={false}
          onPick={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(lastFrame() ?? '').not.toMatch(/\x1b/);
      unmount();
    } finally {
      if (previousForceColor === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = previousForceColor;
    }
  });

  it('bounds tiny heights and renders a plain selected marker without ANSI', () => {
    for (let height = 0; height <= 4; height += 1) {
      const view = render(
        <ListPrompt
          label="Pick"
          items={[
            { key: 'a', label: 'Alpha' },
            { key: 'b', label: 'Beta' },
          ]}
          context="Context"
          progress={{ current: 1, total: 2 }}
          width={12}
          height={height}
          color={false}
          onPick={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const frame = view.lastFrame() ?? '';
      expect(frame === '' ? 0 : stripAnsi(frame).split('\n').length).toBeLessThanOrEqual(height);
      expect(frame).not.toMatch(/\x1b/);
      if (height > 0) expect(frame).toContain('▸');
      view.unmount();
    }
  });

  it('uses initialKey as the selected item for Enter', async () => {
    const onPick = vi.fn();
    const { stdin } = render(
      <ListPrompt
        label="Mode"
        initialKey="json"
        items={[
          { key: 'text', label: 'Text' },
          { key: 'json', label: 'JSON' },
        ]}
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    stdin.write('\r');
    await tick();
    expect(onPick).toHaveBeenCalledWith('json');
  });

  it('picks a single-key item through its shortcut', async () => {
    const onPick = vi.fn();
    const { stdin } = render(
      <ListPrompt
        label="Actions"
        items={[
          { key: 'r', label: 'Run' },
          { key: 's', label: 'Save' },
        ]}
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    stdin.write('s');
    await tick();
    expect(onPick).toHaveBeenCalledWith('s');
  });

  it('shows a disabled reason, lets it be selected, and makes Enter a no-op', async () => {
    const onPick = vi.fn();
    const { lastFrame, stdin } = render(
      <ListPrompt
        label="Actions"
        items={[
          { key: 'run', label: 'Run', disabled: true, disabledReason: 'API key missing' },
          { key: 'save', label: 'Save' },
        ]}
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    expect(lastFrame() ?? '').toContain('API key missing');
    stdin.write('\r');
    await tick();
    expect(onPick).not.toHaveBeenCalled();
    stdin.write('\u001B[B');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onPick).toHaveBeenCalledWith('save');
  });
});
