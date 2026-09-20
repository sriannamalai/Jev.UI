import { describe, expect, it } from 'vitest';
import { LOW_CONFIDENCE, fmt2, renderScale, truncate } from '../src/tui/bars.js';

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
});

describe('LOW_CONFIDENCE', () => {
  it('is 0.8', () => {
    expect(LOW_CONFIDENCE).toBe(0.8);
  });
});
