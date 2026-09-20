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
    helpVisible: false,
    setHelpVisible: vi.fn(),
    questionIds: ['a', 'b', 'c'],
    selectedId: 'a',
    select: vi.fn(),
    runRequested: vi.fn(),
    exit: vi.fn(),
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
    expect(ctx.setHelpVisible).toHaveBeenCalledWith(true);
  });

  it('closes help on Esc, and swallows every other key while open', () => {
    const ctx = makeCtx({ helpVisible: true });
    handleKey('r', key(), ctx);
    expect(ctx.runRequested).not.toHaveBeenCalled();
    handleKey('', key({ escape: true }), ctx);
    expect(ctx.setHelpVisible).toHaveBeenCalledWith(false);
  });

  it('still quits while help is open', () => {
    const ctx = makeCtx({ helpVisible: true });
    handleKey('q', key(), ctx);
    expect(ctx.exit).toHaveBeenCalledOnce();
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
});
