import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  chooseHeredocDelimiter,
  exportRequest,
  toCurl,
  toPython,
  toTypeScript,
} from '../src/export.js';
import type { Request } from '../src/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Same literal as packages/core/test/schema.test.ts's quick-start fixture —
// copied, not imported, per the task instructions.
const quickStart: Request = {
  state:
    "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.",
  model: 'jev-latest',
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which team should handle this',
      criteria: {
        billing: 'Payment or subscription issues',
        technical: 'Bugs or integration problems',
        sales: 'Pricing or account questions',
      },
    },
    frustration: {
      type: 'score',
      instructions: 'How frustrated the customer appears',
      criteria: ['Calm, just stating facts', 'Frustrated but civil', 'Very angry, strong language'],
    },
    is_urgent: { type: 'noul', instructions: 'The message conveys urgency or time-sensitivity' },
  },
};

function golden(name: string): string {
  return readFileSync(join(__dirname, 'golden', name), 'utf8');
}

test('toCurl matches the golden file', () => {
  expect(toCurl(quickStart)).toBe(golden('quickstart.curl.sh'));
});

test('toPython matches the golden file', () => {
  expect(toPython(quickStart)).toBe(golden('quickstart.py'));
});

test('toTypeScript matches the golden file', () => {
  expect(toTypeScript(quickStart)).toBe(golden('quickstart.ts'));
});

test('exportRequest dispatches on target', () => {
  expect(exportRequest('curl', quickStart)).toBe(toCurl(quickStart));
  expect(exportRequest('python', quickStart)).toBe(toPython(quickStart));
  expect(exportRequest('typescript', quickStart)).toBe(toTypeScript(quickStart));
});

test('cURL heredoc body round-trips through tricky state text, picking a safe delimiter', () => {
  const tricky: Request = {
    state: 'it\'s a "quoted" line\nEOF\ncost is $HOME/config',
    questions: {
      is_urgent: { type: 'noul', instructions: 'urgent?' },
    },
  };
  const output = toCurl(tricky);
  const heredocOpen = /<<'([^']+)'\n/.exec(output);
  expect(heredocOpen).not.toBeNull();
  const delimiter = heredocOpen![1];
  const startIndex = heredocOpen!.index + heredocOpen![0].length;
  const endIndex = output.indexOf(`\n${delimiter}\n`, startIndex);
  expect(endIndex).toBeGreaterThan(-1);
  const body = output.slice(startIndex, endIndex);
  expect(JSON.parse(body)).toEqual(tricky);
});

test('chooseHeredocDelimiter falls back when the body has a bare EOF line', () => {
  expect(chooseHeredocDelimiter('{\n  "a": 1\n}')).toBe('EOF');
  expect(chooseHeredocDelimiter('before\nEOF\nafter')).toBe('JEV_EOF_1');
  expect(chooseHeredocDelimiter('before\nEOF\nJEV_EOF_1\nafter')).toBe('JEV_EOF_2');
});

test('Python renders a null choice criterion as None', () => {
  const request: Request = {
    questions: {
      pick: { type: 'choice', instructions: 'pick one', criteria: { a: null } },
    },
    state: 'x',
  };
  expect(toPython(request)).toContain('None');
});

test('Python escapes an emoji in state as a single \\U escape, not a surrogate pair', () => {
  const request: Request = {
    state: 'hello 😀 world',
    questions: { is_urgent: { type: 'noul', instructions: 'x' } },
  };
  const output = toPython(request);
  expect(output).toContain('\\U0001f600');
  expect(output).not.toMatch(/\\u[dD][89abAB][0-9a-fA-F]{2}/);
});

test('omits the model kwarg/property when the request has no model', () => {
  const request: Request = {
    state: 'x',
    questions: { is_urgent: { type: 'noul', instructions: 'urgent?' } },
  };
  expect(toPython(request)).not.toMatch(/model=/);
  expect(toTypeScript(request)).not.toMatch(/model:/);
});

test('never leaks a key value after "Bearer "', () => {
  for (const output of [toCurl(quickStart), toPython(quickStart), toTypeScript(quickStart)]) {
    for (const match of output.matchAll(/Bearer ([^\s"]+)/g)) {
      expect(match[1]).toBe('$TYPESAFE_API_KEY');
    }
  }
});
