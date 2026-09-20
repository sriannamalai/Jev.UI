import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSets, resolveSetsDir } from '../src/sets.js';
import { QuestionSetSchema, type QuestionSet } from '../src/schema.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const set: QuestionSet = {
  name: 'placeholder',
  questions: {
    is_urgent: { type: 'noul', instructions: 'Is this urgent?' },
  },
};

test('save then load round-trips', async () => {
  const sets = createSets(dir);
  await sets.save('support-triage', set);
  const loaded = await sets.load('support-triage');
  expect(loaded).toEqual({ ...set, name: 'support-triage' });
});

test('save rejects a bad name and writes nothing outside the dir', async () => {
  const sets = createSets(dir);
  await expect(sets.save('../evil', set)).rejects.toMatchObject({ code: 'badName' });
  const parent = path.dirname(dir);
  const entries = await fs.readdir(parent);
  expect(entries).not.toContain('evil.json');
  expect(await fs.readdir(dir)).toEqual([]);
});

test('load reports notFound for a missing set', async () => {
  const sets = createSets(dir);
  await expect(sets.load('missing')).rejects.toMatchObject({ code: 'notFound' });
});

test('load reports invalid with the zod path for a bad score question', async () => {
  await fs.writeFile(
    path.join(dir, 'bad.json'),
    JSON.stringify({
      name: 'bad',
      questions: { q: { type: 'score', instructions: 'x', criteria: ['only-one'] } },
    }),
  );
  const sets = createSets(dir);
  await expect(sets.load('bad')).rejects.toMatchObject({
    code: 'invalid',
    path: expect.stringContaining('criteria'),
  });
});

test('list summarises one good and one corrupt file', async () => {
  const sets = createSets(dir);
  await sets.save('good', set);
  await fs.writeFile(path.join(dir, 'corrupt.json'), '{ not json');
  const summaries = await sets.list();
  expect(summaries).toEqual([
    expect.objectContaining({ name: 'corrupt', questionCount: 0, valid: false }),
    { name: 'good', questionCount: 1, valid: true },
  ]);
});

test('list returns [] for a missing dir', async () => {
  const sets = createSets(path.join(dir, 'nope'));
  expect(await sets.list()).toEqual([]);
});

test('list skips files whose basename is not a valid set name', async () => {
  const sets = createSets(dir);
  await fs.writeFile(path.join(dir, 'Not-Valid.json'), '{}');
  expect(await sets.list()).toEqual([]);
});

test('save leaves no temp file behind', async () => {
  const sets = createSets(dir);
  await sets.save('clean', set);
  const entries = await fs.readdir(dir);
  expect(entries.some((f) => f.includes('.tmp-'))).toBe(false);
});

test('save rejects a set that fails QuestionSetSchema and writes nothing', async () => {
  const sets = createSets(dir);
  const invalid = { name: 'x', questions: {} } as unknown as QuestionSet;
  await expect(sets.save('empty', invalid)).rejects.toMatchObject({ code: 'invalid' });
  expect(await fs.readdir(dir)).toEqual([]);
});

test('20 concurrent saves for the same name never corrupt the file and use distinct temp paths', async () => {
  const sets = createSets(dir);
  const payloads: QuestionSet[] = Array.from({ length: 20 }, (_, i) => ({
    name: 'race',
    questions: { q: { type: 'noul', instructions: `payload-${i}` } },
  }));

  const writeSpy = vi.spyOn(fs, 'writeFile');
  await Promise.all(payloads.map((p) => sets.save('race', p)));
  const tempPaths = writeSpy.mock.calls
    .map((call) => call[0])
    .filter((p): p is string => typeof p === 'string' && p.includes('.tmp-'));
  writeSpy.mockRestore();

  expect(new Set(tempPaths).size).toBe(tempPaths.length);

  const text = await fs.readFile(path.join(dir, 'race.json'), 'utf8');
  const data: unknown = JSON.parse(text);
  expect(QuestionSetSchema.safeParse(data).success).toBe(true);
  expect(payloads).toContainEqual(data);

  const entries = await fs.readdir(dir);
  expect(entries.filter((f) => f.includes('.tmp-'))).toEqual([]);
});

test('list skips a directory named like a set file', async () => {
  const sets = createSets(dir);
  await sets.save('good', set);
  await fs.mkdir(path.join(dir, 'dir.json'));
  const summaries = await sets.list();
  expect(summaries).toEqual([{ name: 'good', questionCount: 1, valid: true }]);
});

test('list skips a symlink named like a set file', async () => {
  const sets = createSets(dir);
  await sets.save('good', set);
  try {
    await fs.symlink(path.join(dir, 'good.json'), path.join(dir, 'link.json'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
    throw err;
  }
  const summaries = await sets.list();
  expect(summaries).toEqual([{ name: 'good', questionCount: 1, valid: true }]);
});

test('load rejects a symlink as notFound', async () => {
  const sets = createSets(dir);
  await sets.save('good', set);
  try {
    await fs.symlink(path.join(dir, 'good.json'), path.join(dir, 'link.json'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
    throw err;
  }
  await expect(sets.load('link')).rejects.toMatchObject({ code: 'notFound' });
});

describe('resolveSetsDir', () => {
  test('flag wins over env and cwd', () => {
    expect(resolveSetsDir('/flag/dir', { JEV_SETS_DIR: '/env/dir' }, '/cwd')).toBe('/flag/dir');
  });

  test('env wins over cwd default', () => {
    expect(resolveSetsDir(undefined, { JEV_SETS_DIR: '/env/dir' }, '/cwd')).toBe('/env/dir');
  });

  test('defaults to <cwd>/jev', () => {
    expect(resolveSetsDir(undefined, {}, '/cwd')).toBe(path.join('/cwd', 'jev'));
  });
});
