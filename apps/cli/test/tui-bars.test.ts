import { describe, expect, it } from 'vitest';
import stringWidth from 'string-width';
import {
  LOW_CONFIDENCE,
  displayWidth,
  fmt2,
  padEndDisplay,
  renderScale,
  textOf,
  truncate,
} from '../src/tui/bars.js';

describe('renderScale', () => {
  it('marks the middle level of three, width 11', () => {
    const s = renderScale(1, 3, 11);
    expect(s).toHaveLength(11);
    expect(s.indexOf('●')).toBe(5);
  });

  it('marks the first level', () => {
    expect(renderScale(0, 3, 11).indexOf('●')).toBe(0);
  });

  it('marks the last level', () => {
    expect(renderScale(2, 3, 11).indexOf('●')).toBe(10);
  });

  it('rounds a fractional score', () => {
    expect(renderScale(1.6, 3, 11).indexOf('●')).toBe(8);
  });

  it('clamps a score above the top level', () => {
    expect(renderScale(5, 3, 11).indexOf('●')).toBe(10);
  });

  it('clamps a score below the bottom level', () => {
    expect(renderScale(-1, 3, 11).indexOf('●')).toBe(0);
  });

  it('treats a non-finite score as index 0', () => {
    expect(renderScale(NaN, 3, 11).indexOf('●')).toBe(0);
  });

  it('treats a single level as index 0', () => {
    expect(renderScale(1, 1, 11).indexOf('●')).toBe(0);
  });

  it('returns a bare marker below width 3', () => {
    expect(renderScale(1, 3, 2)).toBe('●');
  });

  it('renders end caps at the outer indices', () => {
    const s = renderScale(2, 5, 9);
    expect(s[0]).toBe('├');
    expect(s[s.length - 1]).toBe('┤');
  });

  it('the marker replaces an end cap when it lands there', () => {
    const s = renderScale(0, 3, 11);
    expect(s[0]).toBe('●');
  });
});

describe('fmt2', () => {
  it('formats to two decimal places', () => {
    expect(fmt2(0.5)).toBe('0.50');
    expect(fmt2(1)).toBe('1.00');
    expect(fmt2(0)).toBe('0.00');
  });

  it('renders non-finite values as an en dash', () => {
    expect(fmt2(NaN)).toBe('–');
    expect(fmt2(Infinity)).toBe('–');
    expect(fmt2(-Infinity)).toBe('–');
  });
});

describe('truncate', () => {
  it('returns the text unchanged when it fits', () => {
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('hi', 5)).toBe('hi');
  });

  it('cuts and appends an ellipsis when too long', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
    expect(truncate('hello world', 8)).toHaveLength(8);
  });

  it('returns an empty string when max is less than 1', () => {
    expect(truncate('hello', 0)).toBe('');
    expect(truncate('hello', -3)).toBe('');
  });

  it('truncates CJK text by DISPLAY width, not character count', () => {
    const result = truncate('日本語のテキスト', 6);
    expect(stringWidth(result)).toBeLessThanOrEqual(6);
    expect(result.endsWith('…')).toBe(true);
  });

  it('never splits inside a ZWJ emoji sequence', () => {
    const text = '👩‍👩‍👧‍👦 family';
    const graphemes = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    ].map((s) => s.segment);
    const result = truncate(text, 4);
    expect(result.endsWith('…')).toBe(true);
    const body = result.slice(0, -1);
    // `body` must be exactly some concatenation of whole leading graphemes
    // from the original text — never a partial cut through one.
    let rebuilt = '';
    for (const grapheme of graphemes) {
      if (!body.startsWith(rebuilt + grapheme)) break;
      rebuilt += grapheme;
    }
    expect(rebuilt).toBe(body);
  });

  it('counts combining marks as width 1 per grapheme cluster', () => {
    const combining = 'é'.repeat(5); // 5 "é" made of e + combining acute accent
    expect(combining.length).toBe(10);
    expect(displayWidth(combining)).toBe(5);
    const result = truncate(combining, 3);
    expect(stringWidth(result)).toBeLessThanOrEqual(3);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('displayWidth', () => {
  it('matches string-width for ASCII, CJK, and emoji', () => {
    expect(displayWidth('hello')).toBe(5);
    expect(displayWidth('日本語')).toBe(6);
  });
});

describe('padEndDisplay', () => {
  it('pads ASCII text to a display width, matching padEnd', () => {
    expect(padEndDisplay('hi', 5)).toBe('hi   ');
  });

  it('pads CJK text to a DISPLAY width, not a character count', () => {
    const result = padEndDisplay('日本', 6);
    expect(stringWidth(result)).toBe(6);
    expect(result.startsWith('日本')).toBe(true);
  });

  it('never truncates when text is already at or over the target width', () => {
    expect(padEndDisplay('hello', 3)).toBe('hello');
  });
});

describe('textOf', () => {
  it('returns a string value unchanged', () => {
    expect(textOf('hello')).toBe('hello');
  });

  it('JSON-stringifies a non-string value', () => {
    expect(textOf(42)).toBe('42');
    expect(textOf({ a: 1 })).toBe('{"a":1}');
    expect(textOf(null)).toBe('null');
  });
});

describe('LOW_CONFIDENCE', () => {
  it('is 0.8', () => {
    expect(LOW_CONFIDENCE).toBe(0.8);
  });
});
