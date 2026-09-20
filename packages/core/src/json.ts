import { findJsonErrorOffset } from './jsonErrorOffset.js';
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
    const offset = findJsonErrorOffset(text);
    const line = offset === undefined ? undefined : lineAtOffset(text, offset);
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

// Deliberately not derived from the engine's SyntaxError message — see
// jsonErrorOffset.ts for why. `offset` comes from findJsonErrorOffset,
// which independently re-scans `text` as strict JSON.
function lineAtOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}
