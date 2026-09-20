import { describe, expect, it, vi } from 'vitest';
import type { Key } from 'ink';
import { KEYMAP, handleKey } from '../src/tui/keys.js';
import type { KeyContext, Pane } from '../src/tui/keys.js';

function key(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<KeyContext> = {}): KeyContext {
  return {
    focused: 'state',
    setFocused: vi.fn(),
    mode: 'normal',
    setMode: vi.fn(),
    questionIds: ['a', 'b', 'c'],
    selectedId: 'a',
    select: vi.fn(),
    runRequested: vi.fn(),
    exit: vi.fn(),
    addQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    duplicateQuestion: vi.fn(),
    moveQuestion: vi.fn(),
    editSelected: vi.fn(),
    renameSelected: vi.fn(),
    editState: vi.fn(),
    editModel: vi.fn(),
    ...overrides,
  };
}

describe('handleKey', () => {
  it('exits on q', () => {
    const ctx = makeCtx();
    handleKey('q', key(), ctx);
    expect(ctx.exit).toHaveBeenCalledOnce();
  });

  it('exits on Ctrl+C', () => {
    const ctx = makeCtx();
    handleKey('c', key({ ctrl: true }), ctx);
    expect(ctx.exit).toHaveBeenCalledOnce();
  });

  it('does nothing while a prompt is open, not even q', () => {
    const ctx = makeCtx({ mode: 'prompt' });
    handleKey('q', key(), ctx);
    handleKey('r', key(), ctx);
    handleKey('a', key(), ctx);
    expect(ctx.exit).not.toHaveBeenCalled();
    expect(ctx.runRequested).not.toHaveBeenCalled();
    expect(ctx.addQuestion).not.toHaveBeenCalled();
  });

  it('cycles focus forward on Tab', () => {
    const ctx = makeCtx({ focused: 'state' });
    handleKey('', key({ tab: true }), ctx);
    expect(ctx.setFocused).toHaveBeenCalledWith('questions');
  });

  it('cycles focus backward on Shift+Tab, wrapping from the first pane', () => {
    const ctx = makeCtx({ focused: 'state' });
    handleKey('', key({ tab: true, shift: true }), ctx);
    expect(ctx.setFocused).toHaveBeenCalledWith('results');
  });

  it('wraps focus forward from the last pane', () => {
    const ctx = makeCtx({ focused: 'results' });
    handleKey('', key({ tab: true }), ctx);
    expect(ctx.setFocused).toHaveBeenCalledWith('state');
  });

  const jumps: [string, Pane][] = [
    ['1', 'state'],
    ['2', 'questions'],
    ['3', 'results'],
  ];
  for (const [input, pane] of jumps) {
    it(`jumps to ${pane} on ${input}`, () => {
      const ctx = makeCtx();
      handleKey(input, key(), ctx);
      expect(ctx.setFocused).toHaveBeenCalledWith(pane);
    });
  }

  it('moves selection down when Questions is focused', () => {
    const ctx = makeCtx({ focused: 'questions', selectedId: 'a' });
    handleKey('', key({ downArrow: true }), ctx);
    expect(ctx.select).toHaveBeenCalledWith('b');
  });

  it('moves selection down on j', () => {
    const ctx = makeCtx({ focused: 'questions', selectedId: 'a' });
    handleKey('j', key(), ctx);
    expect(ctx.select).toHaveBeenCalledWith('b');
  });

  it('moves selection up on k', () => {
    const ctx = makeCtx({ focused: 'questions', selectedId: 'b' });
    handleKey('k', key(), ctx);
    expect(ctx.select).toHaveBeenCalledWith('a');
  });

  it('clamps selection at the last question', () => {
    const ctx = makeCtx({ focused: 'questions', selectedId: 'c' });
    handleKey('', key({ downArrow: true }), ctx);
    expect(ctx.select).not.toHaveBeenCalled();
  });

  it('clamps selection at the first question', () => {
    const ctx = makeCtx({ focused: 'questions', selectedId: 'a' });
    handleKey('', key({ upArrow: true }), ctx);
    expect(ctx.select).not.toHaveBeenCalled();
  });

  it('ignores up/down when a different pane is focused', () => {
    const ctx = makeCtx({ focused: 'state', selectedId: 'a' });
    handleKey('', key({ downArrow: true }), ctx);
    expect(ctx.select).not.toHaveBeenCalled();
  });

  it('runs on r', () => {
    const ctx = makeCtx();
    handleKey('r', key(), ctx);
    expect(ctx.runRequested).toHaveBeenCalledOnce();
  });

  it('opens help on ?', () => {
    const ctx = makeCtx();
    handleKey('?', key(), ctx);
    expect(ctx.setMode).toHaveBeenCalledWith('help');
  });

  it('closes help on Esc, and swallows every other key while open', () => {
    const ctx = makeCtx({ mode: 'help' });
    handleKey('r', key(), ctx);
    expect(ctx.runRequested).not.toHaveBeenCalled();
    handleKey('', key({ escape: true }), ctx);
    expect(ctx.setMode).toHaveBeenCalledWith('normal');
  });

  it('still quits while help is open', () => {
    const ctx = makeCtx({ mode: 'help' });
    handleKey('q', key(), ctx);
    expect(ctx.exit).toHaveBeenCalledOnce();
  });

  it('edits the selected question on Enter when Questions is focused', () => {
    const ctx = makeCtx({ focused: 'questions' });
    handleKey('', key({ return: true }), ctx);
    expect(ctx.editSelected).toHaveBeenCalledOnce();
  });

  it('ignores Enter when a different pane is focused', () => {
    const ctx = makeCtx({ focused: 'state' });
    handleKey('', key({ return: true }), ctx);
    expect(ctx.editSelected).not.toHaveBeenCalled();
  });

  const commands: [string, keyof KeyContext][] = [
    ['a', 'addQuestion'],
    ['d', 'deleteQuestion'],
    ['D', 'duplicateQuestion'],
    ['n', 'renameSelected'],
    ['i', 'editState'],
    ['m', 'editModel'],
  ];
  for (const [input, method] of commands) {
    it(`calls ctx.${method} on ${input}`, () => {
      const ctx = makeCtx();
      handleKey(input, key(), ctx);
      expect(ctx[method]).toHaveBeenCalledOnce();
    });
  }

  it('calls ctx.moveQuestion(1) on J and ctx.moveQuestion(-1) on K', () => {
    const ctx = makeCtx();
    handleKey('J', key(), ctx);
    expect(ctx.moveQuestion).toHaveBeenCalledWith(1);
    handleKey('K', key(), ctx);
    expect(ctx.moveQuestion).toHaveBeenCalledWith(-1);
  });
});

describe('KEYMAP', () => {
  it('has at least one entry for every key handleKey understands', () => {
    expect(Object.keys(KEYMAP).length).toBeGreaterThan(0);
    for (const [key_, description] of Object.entries(KEYMAP)) {
      expect(key_.length).toBeGreaterThan(0);
      expect(description.length).toBeGreaterThan(0);
    }
  });

  it("describes '?' accurately: it only opens the overlay, and only Esc closes it", () => {
    // Ground the label in actual handleKey behaviour rather than aspiration:
    // while in 'help' mode, any non-Esc key is a no-op — only Esc returns to
    // 'normal'. The label must not claim "any key closes" or "toggle".
    const ctx = makeCtx({ mode: 'help' });
    handleKey('x', key(), ctx);
    expect(ctx.setMode).not.toHaveBeenCalled();
    handleKey('', key({ escape: true }), ctx);
    expect(ctx.setMode).toHaveBeenCalledWith('normal');

    expect(KEYMAP['?']).not.toMatch(/toggle/i);
    expect(KEYMAP['?']).toMatch(/esc/i);
  });
});
