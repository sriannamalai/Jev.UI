// Pure text-rendering helpers for the TUI results pane. No Ink dependency
// here so these are trivially unit-testable without a terminal.
import stringWidth from 'string-width';

/** Confidence values at or above this threshold read as normal; below it
 * they render as a warning. Matches `apps/web`'s `LOW_CONFIDENCE`. */
export const LOW_CONFIDENCE = 0.8;

/** Format a number to two decimal places; a non-finite value (NaN, ±Infinity)
 * renders as an en dash rather than "NaN" or "Infinity". */
export function fmt2(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '–';
}

/** Render `value` (which may not be a string, e.g. a criteria description
 * from parsed JSON) as display text. */
export function textOf(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** The number of terminal columns `text` occupies — NOT `text.length`, which
 * counts UTF-16 code units. A CJK character is 2 columns wide but has
 * `.length` 1; many emoji are 2 columns wide and 2+ UTF-16 units;
 * combining marks are 0 columns wide. Free-form user input (state,
 * instructions) needs the real column count to fit a pane without
 * overflowing the frame. */
export function displayWidth(text: string): number {
  return stringWidth(text);
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Truncate `text` to at most `max` DISPLAY columns, appending an ellipsis
 * when cut. Iterates by grapheme cluster (not UTF-16 code unit) so a
 * surrogate pair or ZWJ emoji sequence is never split. `max < 1` returns an
 * empty string. */
export function truncate(text: string, max: number): string {
  if (max < 1) return '';
  if (displayWidth(text) <= max) return text;

  const budget = max - 1; // reserve one column for the ellipsis
  let result = '';
  let width = 0;
  for (const { segment } of segmenter.segment(text)) {
    const segmentWidth = displayWidth(segment);
    if (width + segmentWidth > budget) break;
    result += segment;
    width += segmentWidth;
  }
  return `${result}…`;
}

/** Pad `text` with spaces to a DISPLAY width of `width`. Never truncates —
 * if `text` is already at or over `width` columns it is returned as-is. */
export function padEndDisplay(text: string, width: number): string {
  const textWidth = displayWidth(text);
  if (textWidth >= width) return text;
  return text + ' '.repeat(width - textWidth);
}

/** Render a `width`-wide horizontal scale for a score out of `levels` levels
 * (0-indexed): `├` at the start, `┤` at the end, `─` in between, and a `●`
 * marker at `round(score / (levels - 1) * (width - 1))`, clamped to the
 * line's bounds. The marker replaces whatever character (including an end
 * cap) sits at that index. `levels <= 1` or a non-finite `score` puts the
 * marker at index 0. `width < 3` has no room for end caps, so it returns a
 * bare marker. */
export function renderScale(score: number, levels: number, width: number): string {
  if (width < 3) return '●';

  const chars = new Array<string>(width);
  chars[0] = '├';
  chars[width - 1] = '┤';
  for (let i = 1; i < width - 1; i += 1) chars[i] = '─';

  let index = 0;
  if (levels > 1 && Number.isFinite(score)) {
    const raw = Math.round((score / (levels - 1)) * (width - 1));
    index = Math.max(0, Math.min(width - 1, raw));
  }
  chars[index] = '●';

  return chars.join('');
}
