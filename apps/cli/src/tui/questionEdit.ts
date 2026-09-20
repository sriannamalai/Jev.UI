// Pure, Ink-free helpers for turning a Choice/Score question's criteria into
// editable text lines and back (spec §8.2's Enter-to-edit flow). Kept
// separate from any Ink component so the round-trip and rejection rules are
// unit-testable without a terminal.
import { LIMITS } from '@jev-ui/core';
import type { ChoiceQuestion, ScoreQuestion, Text } from '@jev-ui/core';

/** Shown in place of a non-string (structured) description/level. Left
 * untouched on the way back, the original structured value is restored. */
export const STRUCTURED_PLACEHOLDER = '<structured — edit in JSON>';

function isStructured(value: Text | null | undefined): value is Exclude<Text, string> {
  return value !== null && value !== undefined && typeof value !== 'string';
}

export function choiceToLines(q: ChoiceQuestion): string[] {
  return Object.entries(q.criteria).map(([key, description]) => {
    if (description === null || description === undefined) return `${key}:`;
    if (typeof description !== 'string') return `${key}: ${STRUCTURED_PLACEHOLDER}`;
    return `${key}: ${description}`;
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

  const criteria: Record<string, Text | null> = {};
  const seen = new Set<string>();

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    const rawKey = colonIndex === -1 ? line : line.slice(0, colonIndex);
    const rawDescription = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    const key = rawKey.trim();
    const description = rawDescription.trim();

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

    if (description.length === 0) {
      criteria[key] = null;
    } else if (description === STRUCTURED_PLACEHOLDER && isStructured(previous.criteria[key])) {
      criteria[key] = previous.criteria[key] as Text;
    } else {
      criteria[key] = description;
    }
  }

  return { ok: true, criteria };
}

export function scoreToLines(q: ScoreQuestion): string[] {
  return q.criteria.map((level) => (typeof level === 'string' ? level : STRUCTURED_PLACEHOLDER));
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
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0) {
      return { ok: false, message: `Level ${index + 1} is empty` };
    }
    if (line === STRUCTURED_PLACEHOLDER && isStructured(previous.criteria[index])) {
      criteria.push(previous.criteria[index] as Text);
    } else {
      criteria.push(line);
    }
  }

  return { ok: true, criteria };
}

/** Whether a `Text` value can be edited with a plain text prompt: strings
 * (and an absent value, treated as empty) are editable; structured
 * objects/arrays are not — the UI shows "press E to edit as JSON" instead. */
export function editableText(
  value: Text | undefined,
): { editable: true; text: string } | { editable: false } {
  if (value === undefined) return { editable: true, text: '' };
  if (typeof value === 'string') return { editable: true, text: value };
  return { editable: false };
}
