import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHistory, defaultHistoryFile } from '../src/history.js';
import type { HistoryRecord } from '../src/history.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-'));
  file = path.join(dir, 'sub', 'history.jsonl');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function record(n: number): HistoryRecord {
  return {
    ts: new Date(2026, 0, n).toISOString(),
    request: { state: `s${n}`, questions: { q: { type: 'noul', instructions: 'x' } } },
  };
}

test('append then recent(2) returns the newest first', async () => {
  const history = createHistory(file);
  await history.append(record(1));
  await history.append(record(2));
  await history.append(record(3));
  const recent = await history.recent(2);
  expect(recent.map((r) => r.ts)).toEqual([record(3).ts, record(2).ts]);
});

test('recent skips a garbage line in the middle', async () => {
  const history = createHistory(file);
  await history.append(record(1));
  await fs.appendFile(file, 'not json\n', 'utf8');
  await history.append(record(2));
  const recent = await history.recent(10);
  expect(recent.map((r) => r.ts)).toEqual([record(2).ts, record(1).ts]);
});

test('recent(0) returns []', async () => {
  const history = createHistory(file);
  await history.append(record(1));
  expect(await history.recent(0)).toEqual([]);
});

test('recent(-1) returns []', async () => {
  const history = createHistory(file);
  await history.append(record(1));
  expect(await history.recent(-1)).toEqual([]);
});

test('recent returns [] when the file does not exist', async () => {
  const history = createHistory(file);
  expect(await history.recent(5)).toEqual([]);
});

test('append never throws even when the path is unwritable', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const history = createHistory('/dev/null/x/history.jsonl');
  await expect(history.append(record(1))).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

test('each appended record is exactly one line ending in a newline', async () => {
  const history = createHistory(file);
  await history.append(record(1));
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n').filter((l) => l.length > 0);
  expect(lines).toHaveLength(1);
  expect(text.endsWith('\n')).toBe(true);
});

test('creates the history directory and file with restrictive permissions', async () => {
  const history = createHistory(file);
  await history.append(record(1));
  const dirStat = await fs.stat(path.dirname(file));
  const fileStat = await fs.stat(file);
  expect(dirStat.mode & 0o777).toBe(0o700);
  expect(fileStat.mode & 0o777).toBe(0o600);
});

test('tightens an existing history file to mode 0o600 after appending', async () => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '', { mode: 0o644 });
  const history = createHistory(file);
  await history.append(record(1));
  const fileStat = await fs.stat(file);
  expect(fileStat.mode & 0o777).toBe(0o600);
});

test('defaultHistoryFile uses XDG_DATA_HOME when set', () => {
  expect(defaultHistoryFile({ XDG_DATA_HOME: '/xdg' }, '/home/u')).toBe(
    path.join('/xdg', 'jev-ui', 'history.jsonl'),
  );
});

test('defaultHistoryFile falls back to ~/.local/share when XDG_DATA_HOME is unset', () => {
  expect(defaultHistoryFile({}, '/home/u')).toBe(
    path.join('/home/u', '.local', 'share', 'jev-ui', 'history.jsonl'),
  );
});

test('defaultHistoryFile treats an empty XDG_DATA_HOME as unset', () => {
  expect(defaultHistoryFile({ XDG_DATA_HOME: '' }, '/home/u')).toBe(
    path.join('/home/u', '.local', 'share', 'jev-ui', 'history.jsonl'),
  );
});
