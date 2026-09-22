// Pure, Ink-free helpers for turning a Choice/Score question's criteria into
// editable text lines and back (the Enter-to-edit flow). Kept
// separate from any Ink component so the round-trip and rejection rules are
// unit-testable without a terminal.
import { LIMITS } from '@jev-ui/core';
import type { ChoiceQuestion, Json, ScoreQuestion, Text } from '@jev-ui/core';

export type StructuredText = Json[] | { [key: string]: Json };

export function structuredToLines(value: StructuredText): string[] {
  return JSON.stringify(value, null, 2).split('\n');
}

export function parseStructuredLines(
  lines: string[],
): { ok: true; value: StructuredText } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines.join('\n'));
  } catch {
    return { ok: false, message: 'Enter valid JSON' };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, message: 'JSON must be an object or array' };
  }
  return { ok: true, value: parsed as StructuredText };
}

/** Shown in place of a non-string (structured) description/level. The `#N`
 * is the value's ORIGINAL position, so the placeholder carries identity:
 * moving the line around (or renaming its choice key) still restores value
 * `#N`, and a placeholder that no longer resolves is rejected rather than
 * silently committed as text. */
export function structuredPlaceholder(index: number): string {
  return `<structured #${index} — edit in JSON>`;
}

/** Matches a whole line (or a whole choice description) that is exactly a
 * placeholder; text that merely contains one is ordinary text. */
export const STRUCTURED_PLACEHOLDER_RE = /^<structured #(\d+) — edit in JSON>$/;

/** The original position a placeholder refers to, or `undefined` when `text`
 * is not exactly a placeholder. */
export function structuredPlaceholderIndex(text: string): number | undefined {
  const match = STRUCTURED_PLACEHOLDER_RE.exec(text);
  return match ? Number(match[1]) : undefined;
}

/** Shown when a placeholder cannot be resolved — a made-up `#N`, one that
 * pointed at a plain value, or the same `#N` used on two lines. Nothing is
 * committed in that case: a placeholder must never become data. */
export const STRUCTURED_REJECTED = 'Structured values can only be edited as JSON — press E';
const JSON_TEXT_PREFIX = '=json ';

function encodeEditableString(value: string): string {
  const ambiguous =
    value.length === 0 ||
    value.trim() !== value ||
    /[\r\n]/u.test(value) ||
    value.startsWith(JSON_TEXT_PREFIX) ||
    structuredPlaceholderIndex(value) !== undefined;
  return ambiguous ? `${JSON_TEXT_PREFIX}${JSON.stringify(value)}` : value;
}

function decodeEditableString(
  value: string,
): { ok: true; value: string; encoded: boolean } | { ok: false; message: string } {
  if (!value.startsWith(JSON_TEXT_PREFIX)) return { ok: true, value, encoded: false };
  try {
    const decoded: unknown = JSON.parse(value.slice(JSON_TEXT_PREFIX.length));
    return typeof decoded === 'string'
      ? { ok: true, value: decoded, encoded: true }
      : { ok: false, message: 'Encoded text must be a JSON string' };
  } catch {
    return { ok: false, message: 'Encoded text must be a valid JSON string' };
  }
}

function editableChoiceKey(key: string): string {
  return key.trim() === key && !key.includes(':') && !/[\r\n]/u.test(key) && !key.startsWith('"')
    ? key
    : JSON.stringify(key);
}

function splitChoiceLine(line: string): { key: string; description: string } | undefined {
  if (line.startsWith('"')) {
    const match = /^("(?:\\.|[^"\\])*")\s*:(.*)$/u.exec(line);
    if (!match) return undefined;
    try {
      const key: unknown = JSON.parse(match[1]!);
      if (typeof key !== 'string') return undefined;
      return { key, description: match[2]!.trim() };
    } catch {
      return undefined;
    }
  }
  const colonIndex = line.indexOf(':');
  const rawKey = colonIndex === -1 ? line : line.slice(0, colonIndex);
  const rawDescription = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
  return { key: rawKey.trim(), description: rawDescription.trim() };
}

function isStructured(value: Text | null | undefined): value is Exclude<Text, string> {
  return value !== null && value !== undefined && typeof value !== 'string';
}

export function choiceToLines(q: ChoiceQuestion): string[] {
  return Object.entries(q.criteria).map(([key, description], index) => {
    const editableKey = editableChoiceKey(key);
    if (description === null || description === undefined) return `${editableKey}:`;
    if (typeof description !== 'string') {
      return `${editableKey}: ${structuredPlaceholder(index)}`;
    }
    return `${editableKey}: ${encodeEditableString(description)}`;
  });
}

export function linesToChoice(
  lines: string[],
  previous: ChoiceQuestion,
): { ok: true; criteria: ChoiceQuestion['criteria'] } | { ok: false; message: string } {
  if (lines.length === 0) {
    return { ok: false, message: 'At least one option is required' };
  }
  if (lines.length > LIMITS.choiceMax) {
    return { ok: false, message: `A choice question allows at most ${LIMITS.choiceMax} options` };
  }

  const previousValues = Object.values(previous.criteria);
  const criteria: Record<string, Text | null> = {};
  const seen = new Set<string>();
  const usedPlaceholders = new Set<number>();

  for (const line of lines) {
    const parsedLine = splitChoiceLine(line);
    if (!parsedLine) return { ok: false, message: 'Quoted option keys must be valid JSON strings' };
    const { key } = parsedLine;
    const decoded = decodeEditableString(parsedLine.description);
    if (!decoded.ok) return decoded;
    const description = decoded.value;

    if (key.length === 0) {
      return { ok: false, message: 'Option key cannot be empty' };
    }
    if (key === '__proto__') {
      return { ok: false, message: 'This key is not allowed' };
    }
    if (seen.has(key)) {
      return { ok: false, message: `Duplicate option key: ${key}` };
    }
    seen.add(key);

    const placeholder = decoded.encoded ? undefined : structuredPlaceholderIndex(description);
    if (placeholder !== undefined) {
      const value = previousValues[placeholder];
      if (!isStructured(value) || usedPlaceholders.has(placeholder)) {
        return { ok: false, message: STRUCTURED_REJECTED };
      }
      usedPlaceholders.add(placeholder);
      criteria[key] = value;
    } else if (description.length === 0 && !decoded.encoded) {
      criteria[key] = null;
    } else {
      criteria[key] = description;
    }
  }

  return { ok: true, criteria };
}

export function scoreToLines(q: ScoreQuestion): string[] {
  return q.criteria.map((level, index) =>
    typeof level === 'string' ? encodeEditableString(level) : structuredPlaceholder(index),
  );
}

export function linesToScore(
  lines: string[],
  previous: ScoreQuestion,
): { ok: true; criteria: ScoreQuestion['criteria'] } | { ok: false; message: string } {
  if (lines.length < LIMITS.scoreMin || lines.length > LIMITS.scoreMax) {
    return {
      ok: false,
      message: `A score needs ${LIMITS.scoreMin} to ${LIMITS.scoreMax} levels`,
    };
  }

  const criteria: Text[] = [];
  const usedPlaceholders = new Set<number>();
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    const decoded = decodeEditableString(line);
    if (!decoded.ok) return decoded;
    if (decoded.value.length === 0 && !decoded.encoded) {
      return { ok: false, message: `Level ${index + 1} is empty` };
    }
    const placeholder = decoded.encoded ? undefined : structuredPlaceholderIndex(decoded.value);
    if (placeholder !== undefined) {
      const value = previous.criteria[placeholder];
      if (!isStructured(value) || usedPlaceholders.has(placeholder)) {
        return { ok: false, message: STRUCTURED_REJECTED };
      }
      usedPlaceholders.add(placeholder);
      criteria.push(value);
    } else {
      criteria.push(decoded.value);
    }
  }

  return { ok: true, criteria };
}

/** Whether a `Text` value belongs in the plain text editor: strings (and an
 * absent value, treated as empty) do; structured objects/arrays are routed
 * to the validated JSON lines editor. */
export function editableText(
  value: Text | undefined,
): { editable: true; text: string } | { editable: false } {
  if (value === undefined) return { editable: true, text: '' };
  if (typeof value === 'string') return { editable: true, text: value };
  return { editable: false };
}
