import { describe, expect, it } from 'vitest';
import type { ChoiceQuestion, ScoreQuestion } from '@jev-ui/core';
import {
  choiceToLines,
  editableText,
  linesToChoice,
  linesToScore,
  scoreToLines,
} from '../src/tui/questionEdit.js';

const STRUCTURED_PLACEHOLDER = '<structured — edit in JSON>';

function choiceQ(criteria: ChoiceQuestion['criteria']): ChoiceQuestion {
  return { type: 'choice', instructions: 'Pick one', criteria };
}

function scoreQ(criteria: ScoreQuestion['criteria']): ScoreQuestion {
  return { type: 'score', instructions: 'Rate it', criteria };
}

describe('choiceToLines / linesToChoice', () => {
  it('round-trips key: description lines', () => {
    const q = choiceQ({ technical: 'A tech issue', sales: null, billing: 'Billing question' });
    const lines = choiceToLines(q);
    expect(lines).toEqual(['technical: A tech issue', 'sales:', 'billing: Billing question']);
    const result = linesToChoice(lines, q);
    expect(result).toEqual({ ok: true, criteria: q.criteria });
  });

  it('keeps everything after the first colon as the description', () => {
    const result = linesToChoice(['key: with: colons'], choiceQ({ key: null }));
    expect(result).toEqual({ ok: true, criteria: { key: 'with: colons' } });
  });

  it('trims whitespace around key and description', () => {
    const result = linesToChoice(['  key  :   desc  '], choiceQ({ key: null }));
    expect(result).toEqual({ ok: true, criteria: { key: 'desc' } });
  });

  it('treats a line without a colon as a key with a null description', () => {
    const result = linesToChoice(['onlykey'], choiceQ({ onlykey: null }));
    expect(result).toEqual({ ok: true, criteria: { onlykey: null } });
  });

  it('rejects no lines', () => {
    const result = linesToChoice([], choiceQ({ a: null }));
    expect(result).toEqual({ ok: false, message: 'At least one option is required' });
  });

  it('rejects more than 255 options', () => {
    const lines = Array.from({ length: 256 }, (_, i) => `opt_${i}:`);
    const result = linesToChoice(lines, choiceQ({ a: null }));
    expect(result).toEqual({ ok: false, message: 'A choice question allows at most 255 options' });
  });

  it('rejects an empty key', () => {
    const result = linesToChoice([': description'], choiceQ({ a: null }));
    expect(result).toEqual({ ok: false, message: 'Option key cannot be empty' });
  });

  it('rejects a duplicate key', () => {
    const result = linesToChoice(['a: one', 'a: two'], choiceQ({ a: null }));
    expect(result).toEqual({ ok: false, message: 'Duplicate option key: a' });
  });

  it('rejects the key __proto__', () => {
    const result = linesToChoice(['__proto__: x'], choiceQ({ a: null }));
    expect(result).toEqual({ ok: false, message: 'This key is not allowed' });
  });

  it('renders a structured description as a placeholder', () => {
    const q = choiceQ({ key: { nested: 'value' } });
    expect(choiceToLines(q)).toEqual([`key: ${STRUCTURED_PLACEHOLDER}`]);
  });

  it('preserves a structured description when the line is left untouched', () => {
    const structured = { nested: 'value' };
    const q = choiceQ({ key: structured });
    const lines = choiceToLines(q);
    const result = linesToChoice(lines, q);
    expect(result).toEqual({ ok: true, criteria: { key: structured } });
  });

  it('replaces a structured description when the line is edited', () => {
    const q = choiceQ({ key: { nested: 'value' } });
    const result = linesToChoice(['key: plain text now'], q);
    expect(result).toEqual({ ok: true, criteria: { key: 'plain text now' } });
  });
});

describe('scoreToLines / linesToScore', () => {
  it('round-trips levels', () => {
    const q = scoreQ(['Calm', 'Angry']);
    const lines = scoreToLines(q);
    expect(lines).toEqual(['Calm', 'Angry']);
    const result = linesToScore(lines, q);
    expect(result).toEqual({ ok: true, criteria: q.criteria });
  });

  it('trims whitespace around each level', () => {
    const result = linesToScore(['  Calm  ', '  Angry '], scoreQ(['Calm', 'Angry']));
    expect(result).toEqual({ ok: true, criteria: ['Calm', 'Angry'] });
  });

  it('rejects fewer than 2 levels', () => {
    const result = linesToScore(['Calm'], scoreQ(['Calm', 'Angry']));
    expect(result).toEqual({ ok: false, message: 'A score needs 2 to 10 levels' });
  });

  it('rejects more than 10 levels', () => {
    const lines = Array.from({ length: 11 }, (_, i) => `Level ${i}`);
    const result = linesToScore(lines, scoreQ(['Calm', 'Angry']));
    expect(result).toEqual({ ok: false, message: 'A score needs 2 to 10 levels' });
  });

  it('rejects an empty line in the middle', () => {
    const result = linesToScore(['Calm', '', 'Angry'], scoreQ(['Calm', 'Mid', 'Angry']));
    expect(result).toEqual({ ok: false, message: 'Level 2 is empty' });
  });

  it('renders a structured level as a placeholder', () => {
    const q = scoreQ(['Calm', { nested: 'value' }]);
    expect(scoreToLines(q)).toEqual(['Calm', STRUCTURED_PLACEHOLDER]);
  });

  it('preserves a structured level when the line is left untouched', () => {
    const structured = { nested: 'value' };
    const q = scoreQ(['Calm', structured]);
    const lines = scoreToLines(q);
    const result = linesToScore(lines, q);
    expect(result).toEqual({ ok: true, criteria: ['Calm', structured] });
  });

  it('replaces a structured level when the line is edited', () => {
    const q = scoreQ(['Calm', { nested: 'value' }]);
    const result = linesToScore(['Calm', 'plain text now'], q);
    expect(result).toEqual({ ok: true, criteria: ['Calm', 'plain text now'] });
  });
});

describe('editableText', () => {
  it('is editable for a string', () => {
    expect(editableText('hello')).toEqual({ editable: true, text: 'hello' });
  });

  it('is editable (empty) for undefined', () => {
    expect(editableText(undefined)).toEqual({ editable: true, text: '' });
  });

  it('is not editable for a structured object', () => {
    expect(editableText({ nested: 'value' })).toEqual({ editable: false });
  });

  it('is not editable for an array', () => {
    expect(editableText([1, 2, 3])).toEqual({ editable: false });
  });
});
