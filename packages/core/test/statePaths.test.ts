import { expect, test } from 'vitest';
import { activeBacktick, completePaths, enumeratePaths } from '../src/statePaths.js';

test('string state has no paths', () => {
  expect(enumeratePaths('just text')).toEqual([]);
});

test('enumeratePaths walks objects and arrays', () => {
  const paths = enumeratePaths({ ticket: { messages: [{ text: 'a' }] } });
  expect(paths).toContain('ticket');
  expect(paths).toContain('ticket.messages');
  expect(paths).toContain('ticket.messages[0]');
  expect(paths).toContain('ticket.messages[0].text');
});

test('a key needing quoting is emitted in bracket-quote form', () => {
  const paths = enumeratePaths({ 'a b': 1 });
  expect(paths).toContain('["a b"]');
});

test('maxPaths truncates the result', () => {
  const state = { a: 1, b: 2, c: 3, d: 4, e: 5 };
  const paths = enumeratePaths(state, { maxPaths: 2 });
  expect(paths.length).toBeLessThanOrEqual(2);
});

test('maxDepth stops descent', () => {
  const state = { a: { b: { c: 1 } } };
  const paths = enumeratePaths(state, { maxDepth: 1 });
  expect(paths).toContain('a');
  expect(paths).not.toContain('a.b');
});

test('activeBacktick finds the query inside an open backtick pair', () => {
  expect(activeBacktick('Is `tick', 8)).toEqual({ start: 4, query: 'tick' });
});

test('activeBacktick returns undefined once the pair is closed', () => {
  const text = 'Is `done` yet';
  expect(activeBacktick(text, text.length)).toBeUndefined();
});

test('completePaths ranks prefix matches before substring matches', () => {
  const paths = ['ticket.messages', 'x.ticket', 'ticket'];
  const result = completePaths(paths, 'ticket');
  expect(result).toEqual(['ticket.messages', 'ticket', 'x.ticket']);
});
