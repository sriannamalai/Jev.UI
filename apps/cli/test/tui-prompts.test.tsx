import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ChoicePrompt, LinesPrompt, TextPrompt } from '../src/tui/Prompts.js';

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function escapeTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
}

describe('TextPrompt', () => {
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
});

describe('LinesPrompt', () => {
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

  it('Ctrl+S submits, dropping trailing empty lines', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <LinesPrompt label="Options" initial={['a']} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    stdin.write('\r'); // new empty line below 'a'
    await tick();
    stdin.write('\u0013');
    await tick();
    expect(onSubmit).toHaveBeenCalledWith(['a']);
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
});

describe('ChoicePrompt', () => {
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
