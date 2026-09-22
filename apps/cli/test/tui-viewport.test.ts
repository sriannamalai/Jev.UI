import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { wrapDisplayText } from '../src/tui/Viewport.js';

describe('wrapDisplayText', () => {
  it('wraps every logical line by terminal columns without splitting Unicode graphemes', () => {
    const lines = wrapDisplayText('顧客🙂e\u0301abc\nsecond line', 6);

    expect(lines).toEqual(['顧客🙂', 'e\u0301abc', 'second', ' line']);
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(6);
  });

  it('preserves an empty logical line', () => {
    expect(wrapDisplayText('one\n\nthree', 8)).toEqual(['one', '', 'three']);
  });

  it('uses an ASCII code-point escape when one grapheme is wider than the viewport', () => {
    const lines = wrapDisplayText('技', 1);
    expect(lines.join('')).toBe('\\u{6280}');
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(1);
  });
});
