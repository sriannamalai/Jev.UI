// Pure text-rendering helpers for the TUI results pane. No Ink dependency
// here so these are trivially unit-testable without a terminal.

/** Confidence values at or above this threshold read as normal; below it
 * they render as a warning (spec §8.2). Matches `apps/web`'s `LOW_CONFIDENCE`. */
export const LOW_CONFIDENCE = 0.8;

/** Format a number to two decimal places; a non-finite value (NaN, ±Infinity)
 * renders as an en dash rather than "NaN" or "Infinity". */
export function fmt2(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '–';
}

/** Truncate `text` to at most `max` characters, appending an ellipsis when
 * cut. `max < 1` returns an empty string. */
export function truncate(text: string, max: number): string {
  if (max < 1) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
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
