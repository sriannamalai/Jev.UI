import { expect, test } from 'vitest';
import { findJsonErrorOffset } from '../src/jsonErrorOffset.js';

test('valid nested document is undefined', () => {
  expect(findJsonErrorOffset('{"a": [1, {"b": true}, null], "c": "x"}')).toBeUndefined();
});

test('valid string escapes (including \\uXXXX) are undefined', () => {
  expect(findJsonErrorOffset('{"a": "line\\nbreak \\u00e9 \\" \\\\"}')).toBeUndefined();
});

test('valid numbers (negative, decimal, exponent) are undefined', () => {
  expect(findJsonErrorOffset('[-0.5e+10, 0, -3, 1.25E-4]')).toBeUndefined();
});

test('empty object and array are undefined', () => {
  expect(findJsonErrorOffset('{}')).toBeUndefined();
  expect(findJsonErrorOffset('[]')).toBeUndefined();
});

test('trailing comma in an array reports the offset of the closing bracket', () => {
  const text = '[1, 2, ]';
  expect(findJsonErrorOffset(text)).toBe(text.indexOf(']'));
});

test('trailing comma in an object reports the offset of the closing brace', () => {
  const text = '{"a": 1, }';
  expect(findJsonErrorOffset(text)).toBe(text.indexOf('}'));
});

test('missing value after a key reports the offset of the closing brace', () => {
  const text = '{"a": }';
  expect(findJsonErrorOffset(text)).toBe(text.indexOf('}'));
});

test('unterminated string reports text.length', () => {
  const text = '{"a": "unterminated}';
  expect(findJsonErrorOffset(text)).toBe(text.length);
});

test('truncated input reports text.length', () => {
  const text = '{"a": [1,';
  expect(findJsonErrorOffset(text)).toBe(text.length);
});

test('a bare word reports the offset of its first character', () => {
  const text = '{"a": nope}';
  expect(findJsonErrorOffset(text)).toBe(text.indexOf('nope'));
});

test('a leading zero followed by another digit reports offset 1', () => {
  expect(findJsonErrorOffset('01')).toBe(1);
});

test('an invalid escape reports the offset of the escape letter', () => {
  const text = '"\\q"';
  expect(findJsonErrorOffset(text)).toBe(text.indexOf('q'));
});

test('an unescaped control character inside a string reports its offset', () => {
  const text = `"a${String.fromCharCode(1)}b"`;
  expect(findJsonErrorOffset(text)).toBe(2);
});

test('trailing garbage after a valid value reports its offset', () => {
  const text = '{} x';
  expect(findJsonErrorOffset(text)).toBe(text.indexOf('x'));
});

test('empty string reports text.length', () => {
  expect(findJsonErrorOffset('')).toBe(0);
});

test('whitespace-only input reports text.length', () => {
  const text = '   \n  ';
  expect(findJsonErrorOffset(text)).toBe(text.length);
});
