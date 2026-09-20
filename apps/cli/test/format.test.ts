import type { RunResult } from '@jev-ui/core';
import { describe, expect, it } from 'vitest';
import { bar, formatResult } from '../src/format.js';

const QUICKSTART_RESULT: RunResult = {
  answers: {
    department: {
      type: 'choice',
      choice: 'technical',
      probabilities: { billing: 0.1, technical: 0.75, sales: 0.15 },
      confidence: 0.75,
    },
    frustration: {
      type: 'score',
      score: 1,
      legend: {
        '0': 'Calm, just stating facts',
        '1': 'Frustrated but civil',
        '2': 'Very angry, strong language',
      },
      probabilities: { '0': 0.12, '1': 0.83, '2': 0.05 },
      confidence: 0.83,
    },
    is_urgent: {
      type: 'noul',
      noul: 0.62,
    },
  },
  model: 'jev-1.13.0',
  usage: { inputTokens: 425, outputTokens: 100 },
  latencyMs: 894,
  costUsd: 0.000018,
};

const EXPECTED = [
  'choice  department  technical  conf 0.75',
  '  technical  ███████████████████████████████░░░░░░░░░░  0.75',
  '  sales      ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0.15',
  '  billing    ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0.10',
  '',
  'score  frustration  1.00  Frustrated but civil  conf 0.83',
  '  0 · Calm, just stating facts     ██░░░░░░░░░░░░░░░░░  0.12',
  '  1 · Frustrated but civil         ████████████████░░░  0.83',
  '  2 · Very angry, strong language  █░░░░░░░░░░░░░░░░░░  0.05',
  '',
  'noul  is_urgent',
  '  P(yes)  ███████████████████████████░░░░░░░░░░░░░░░░░  0.62',
  '',
  'jev-1.13.0 · 894 ms · 425 tok · $0.000018',
].join('\n');

describe('bar', () => {
  it('renders a half-filled bar', () => {
    expect(bar(0.5, 10)).toBe('█████░░░░░');
  });

  it('clamps values above 1', () => {
    expect(bar(2, 4)).toBe('████');
  });

  it('clamps values below 0', () => {
    expect(bar(-1, 4)).toBe('░░░░');
  });
});

describe('formatResult', () => {
  it('renders the quick-start result at width 60 with no color', () => {
    expect(formatResult(QUICKSTART_RESULT, { width: 60, color: false })).toBe(EXPECTED);
  });

  it('emits no ESC characters when color is false', () => {
    const out = formatResult(QUICKSTART_RESULT, { width: 60, color: false });
    expect(out).not.toMatch(/\x1b/);
  });

  it('emits ESC characters when color is true', () => {
    const out = formatResult(QUICKSTART_RESULT, { width: 60, color: true });
    expect(out).toMatch(/\x1b/);
  });
});
