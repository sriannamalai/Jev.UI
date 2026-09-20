import type { Json, Text } from './schema.js';

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function joinKey(prefix: string, key: string): string {
  if (IDENT_RE.test(key)) return prefix ? `${prefix}.${key}` : key;
  return `${prefix}[${JSON.stringify(key)}]`;
}

function joinIndex(prefix: string, index: number): string {
  return `${prefix}[${index}]`;
}

export function enumeratePaths(
  state: Text,
  opts?: { maxDepth?: number; maxPaths?: number },
): string[] {
  if (typeof state === 'string') return [];

  const maxDepth = opts?.maxDepth ?? 6;
  const maxPaths = opts?.maxPaths ?? 500;
  const paths: string[] = [];

  function walk(node: Json, prefix: string, depth: number): void {
    if (depth >= maxDepth) return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (paths.length >= maxPaths) return;
        const path = joinIndex(prefix, i);
        paths.push(path);
        walk(node[i] as Json, path, depth + 1);
      }
      return;
    }

    if (node !== null && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        if (paths.length >= maxPaths) return;
        const path = joinKey(prefix, key);
        paths.push(path);
        walk((node as Record<string, Json>)[key] as Json, path, depth + 1);
      }
    }
  }

  walk(state, '', 0);
  return paths;
}

export function activeBacktick(
  text: string,
  caret: number,
): { start: number; query: string } | undefined {
  const before = text.slice(0, caret);
  const backtickCount = (before.match(/`/g) ?? []).length;
  if (backtickCount % 2 === 0) return undefined;

  const openIdx = before.lastIndexOf('`');
  const start = openIdx + 1;
  return { start, query: text.slice(start, caret) };
}

export function completePaths(paths: string[], query: string, limit?: number): string[] {
  const q = query.toLowerCase();
  const prefixMatches: string[] = [];
  const substringMatches: string[] = [];

  for (const p of paths) {
    const lower = p.toLowerCase();
    if (lower.startsWith(q)) {
      prefixMatches.push(p);
    } else if (lower.includes(q)) {
      substringMatches.push(p);
    }
  }

  const ranked = [...prefixMatches, ...substringMatches];
  return limit === undefined ? ranked : ranked.slice(0, limit);
}
