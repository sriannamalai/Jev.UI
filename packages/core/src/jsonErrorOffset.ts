// Deterministic RFC 8259 JSON validator used only to locate *where* a
// document stops being valid JSON, so the UI can point at a line number.
// This deliberately does NOT rely on any engine's JSON.parse error message —
// this module runs in browsers too, and Firefox/Safari/Chrome/Node all word
// (and locate) SyntaxErrors differently, so parsing those messages is not a
// portable way to get an offset. It also fixes a real bug the message-based
// approach had: text.lastIndexOf(offendingChar) picks the *last* match in
// the whole document, which is wrong whenever that character repeats.
//
// Internal only — not re-exported from browser.ts.

// Recursive descent means stack depth tracks JSON nesting depth. Past this
// many nested objects/arrays we give up rather than risk a real stack
// overflow (a RangeError, not a JsonScanError). Giving up returns
// `undefined` ("no reliable offset"), never a fabricated offset — the
// document may be perfectly valid JSON that is merely deep, and reporting
// a bogus error location would be worse than reporting none.
const MAX_DEPTH = 1000;

class JsonScanError {
  constructor(readonly offset: number) {}
}

class DepthLimitExceeded {}

/**
 * Returns the 0-based offset of the first character at which `text` stops
 * being valid JSON, `text.length` for an unexpected end of input, or
 * `undefined` if `text` is valid JSON OR if scanning had to give up (depth
 * limit, or any other unexpected failure — this function is total and
 * never throws).
 */
export function findJsonErrorOffset(text: string): number | undefined {
  const len = text.length;
  let i = 0;
  let depth = 0;

  const fail = (offset: number): never => {
    throw new JsonScanError(offset);
  };

  const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
  const isHexDigit = (c: string | undefined): boolean => c !== undefined && /^[0-9a-fA-F]$/.test(c);
  const isWhitespace = (c: string | undefined): boolean =>
    c === ' ' || c === '\t' || c === '\n' || c === '\r';

  const skipWhitespace = (): void => {
    while (i < len && isWhitespace(text[i])) i++;
  };

  const parseString = (): void => {
    i++; // opening quote, already confirmed by the caller
    for (;;) {
      if (i >= len) fail(len);
      const c = text[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c === '\\') {
        const escapeOffset = i + 1;
        if (escapeOffset >= len) fail(len);
        const esc = text[escapeOffset];
        if (
          esc === '"' ||
          esc === '\\' ||
          esc === '/' ||
          esc === 'b' ||
          esc === 'f' ||
          esc === 'n' ||
          esc === 'r' ||
          esc === 't'
        ) {
          i = escapeOffset + 1;
          continue;
        }
        if (esc === 'u') {
          for (let k = 1; k <= 4; k++) {
            const idx = escapeOffset + k;
            if (idx >= len) fail(len);
            if (!isHexDigit(text[idx])) fail(idx);
          }
          i = escapeOffset + 5;
          continue;
        }
        // Invalid escape: report the offset of the character after the
        // backslash (the unrecognised escape letter itself).
        fail(escapeOffset);
      }
      if (c !== undefined && c.charCodeAt(0) <= 0x1f) fail(i);
      i++;
    }
  };

  const parseNumber = (): void => {
    if (text[i] === '-') i++;
    if (i >= len) fail(len);
    if (text[i] === '0') {
      i++;
      if (isDigit(text[i])) fail(i);
    } else if (isDigit(text[i])) {
      i++;
      while (isDigit(text[i])) i++;
    } else {
      fail(i);
    }
    if (text[i] === '.') {
      i++;
      if (!isDigit(text[i])) fail(i >= len ? len : i);
      while (isDigit(text[i])) i++;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      if (!isDigit(text[i])) fail(i >= len ? len : i);
      while (isDigit(text[i])) i++;
    }
  };

  const parseValue = (): void => {
    skipWhitespace();
    if (i >= len) fail(len);
    const c = text[i];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    if (c === '-' || isDigit(c)) return parseNumber();
    if (text.startsWith('true', i)) {
      i += 4;
      return;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return;
    }
    fail(i);
  };

  function parseObject(): void {
    depth++;
    if (depth > MAX_DEPTH) throw new DepthLimitExceeded();
    try {
      i++; // '{'
      skipWhitespace();
      if (text[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        skipWhitespace();
        if (i >= len) fail(len);
        if (text[i] !== '"') fail(i);
        parseString();
        skipWhitespace();
        if (i >= len) fail(len);
        if (text[i] !== ':') fail(i);
        i++;
        parseValue();
        skipWhitespace();
        if (i >= len) fail(len);
        if (text[i] === ',') {
          i++;
          skipWhitespace();
          if (text[i] === '}') fail(i); // trailing comma
          continue;
        }
        if (text[i] === '}') {
          i++;
          return;
        }
        fail(i);
      }
    } finally {
      depth--;
    }
  }

  function parseArray(): void {
    depth++;
    if (depth > MAX_DEPTH) throw new DepthLimitExceeded();
    try {
      i++; // '['
      skipWhitespace();
      if (text[i] === ']') {
        i++;
        return;
      }
      for (;;) {
        parseValue();
        skipWhitespace();
        if (i >= len) fail(len);
        if (text[i] === ',') {
          i++;
          skipWhitespace();
          if (text[i] === ']') fail(i); // trailing comma
          continue;
        }
        if (text[i] === ']') {
          i++;
          return;
        }
        fail(i);
      }
    } finally {
      depth--;
    }
  }

  try {
    parseValue();
    skipWhitespace();
    if (i < len) fail(i); // trailing garbage after a valid value
    return undefined;
  } catch (err) {
    // Total function: a JsonScanError carries a real offset; anything else
    // (DepthLimitExceeded, or any other unexpected failure) means we could
    // not reliably determine one.
    if (err instanceof JsonScanError) return err.offset;
    return undefined;
  }
}
