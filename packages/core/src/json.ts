import { RequestSchema, type Request } from './schema.js';

export function serializeRequest(request: Request): string {
  return JSON.stringify(request, null, 2);
}

export type ParseResult =
  { ok: true; request: Request } | { ok: false; message: string; line?: number; path?: string };

export function parseRequestJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const line = deriveLine(message, text);
    return line === undefined ? { ok: false, message } : { ok: false, message, line };
  }

  const result = RequestSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const message = issue?.message ?? 'Invalid request';
    const path = issue ? formatPath(issue.path) : undefined;
    return path === undefined ? { ok: false, message } : { ok: false, message, path };
  }
  return { ok: true, request: result.data };
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, segment, index) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return index === 0 ? String(segment) : `${acc}.${String(segment)}`;
  }, '');
}

// V8's SyntaxError message usually looks like "... at position N (line L column C)".
// Some "Unexpected token" variants omit position/line entirely and instead quote the
// offending token; for those we fall back to locating the last occurrence of that
// token in the source text to give a best-effort line number.
function deriveLine(message: string, text: string): number | undefined {
  const lineMatch = /\(line (\d+) column \d+\)/.exec(message);
  if (lineMatch?.[1]) return Number(lineMatch[1]);

  const posMatch = /position (\d+)/.exec(message);
  if (posMatch?.[1]) return lineAtPosition(text, Number(posMatch[1]));

  const tokenMatch = /Unexpected token '(.+?)'/.exec(message);
  if (tokenMatch?.[1]) {
    const idx = text.lastIndexOf(tokenMatch[1]);
    if (idx !== -1) return lineAtPosition(text, idx);
  }

  return undefined;
}

function lineAtPosition(text: string, position: number): number {
  let line = 1;
  for (let i = 0; i < position && i < text.length; i++) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}
