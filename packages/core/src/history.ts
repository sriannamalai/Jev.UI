import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { JevErrorKind } from './errors.js';
import type { Request, RunResult } from './schema.js';

export interface HistoryRecord {
  ts: string;
  request: Request;
  result?: RunResult;
  error?: { kind: JevErrorKind; message: string };
  setName?: string;
}

export interface HistoryStore {
  file: string;
  append(r: HistoryRecord): Promise<void>;
  recent(limit: number): Promise<HistoryRecord[]>;
}

export function defaultHistoryFile(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(home, '.local', 'share');
  return path.join(base, 'jev-ui', 'history.jsonl');
}

export function createHistory(file: string = defaultHistoryFile()): HistoryStore {
  return {
    file,
    append: (record: HistoryRecord) => append(file, record),
    recent: (limit: number) => recent(file, limit),
  };
}

async function append(file: string, record: HistoryRecord): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const line = `${JSON.stringify(record)}\n`;
    await fs.appendFile(file, line, { encoding: 'utf8', mode: 0o600, flag: 'a' });
  } catch (err) {
    console.warn('jev-ui: failed to append history record', err);
  }
}

async function recent(file: string, limit: number): Promise<HistoryRecord[]> {
  if (limit <= 0) return [];

  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return [];
  }

  const records: HistoryRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      records.push(JSON.parse(line) as HistoryRecord);
    } catch {
      // skip unparseable lines
    }
  }

  return records.slice(-limit).reverse();
}
