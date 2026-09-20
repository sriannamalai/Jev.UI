import { randomUUID } from 'node:crypto';
import { promises as fs, type Dirent } from 'node:fs';
import * as nodePath from 'node:path';
import type { ZodError } from 'zod';
import { formatPath } from './json.js';
import { QuestionSetSchema, type QuestionSet, type SetSummary } from './schema.js';
import { SET_NAME_RE } from './set.js';

export interface SetsStore {
  dir: string;
  list(): Promise<SetSummary[]>;
  load(name: string): Promise<QuestionSet>;
  save(name: string, set: QuestionSet): Promise<void>;
}

export class SetError extends Error {
  readonly code: 'badName' | 'notFound' | 'invalid';
  readonly file?: string;
  readonly path?: string;

  constructor(
    code: 'badName' | 'notFound' | 'invalid',
    message: string,
    extra?: { file?: string; path?: string },
  ) {
    super(message);
    this.name = 'SetError';
    this.code = code;
    this.file = extra?.file;
    this.path = extra?.path;
  }
}

export function resolveSetsDir(
  flag?: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const dir = flag ?? env.JEV_SETS_DIR ?? nodePath.join(cwd, 'jev');
  return nodePath.resolve(cwd, dir);
}

export function createSets(dir: string): SetsStore {
  return {
    dir,
    list: () => list(dir),
    load: (name: string) => load(dir, name),
    save: (name: string, set: QuestionSet) => save(dir, name, set),
  };
}

async function list(dir: string): Promise<SetSummary[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }

  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .filter((name) => SET_NAME_RE.test(name))
    .sort();

  const summaries: SetSummary[] = [];
  for (const name of names) {
    const file = nodePath.join(dir, `${name}.json`);
    try {
      const text = await fs.readFile(file, 'utf8');
      const data: unknown = JSON.parse(text);
      const result = QuestionSetSchema.safeParse(data);
      if (!result.success) {
        summaries.push({
          name,
          questionCount: 0,
          valid: false,
          error: describeInvalid(file, result.error).message,
        });
        continue;
      }
      summaries.push({
        name,
        questionCount: Object.keys(result.data.questions).length,
        valid: true,
      });
    } catch (err) {
      summaries.push({
        name,
        questionCount: 0,
        valid: false,
        error: `Invalid JSON in ${file}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return summaries;
}

async function load(dir: string, name: string): Promise<QuestionSet> {
  if (!SET_NAME_RE.test(name)) {
    throw new SetError('badName', `Invalid set name: ${name}`);
  }

  const file = nodePath.join(dir, `${name}.json`);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile()) {
      throw new SetError('notFound', `Question set not found: ${file}`, { file });
    }
  } catch (err) {
    if (err instanceof SetError) throw err;
    if (isEnoent(err)) {
      throw new SetError('notFound', `Question set not found: ${file}`, { file });
    }
    throw err;
  }

  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (isEnoent(err)) {
      throw new SetError('notFound', `Question set not found: ${file}`, { file });
    }
    throw err;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new SetError(
      'invalid',
      `Invalid JSON in ${file}: ${err instanceof Error ? err.message : String(err)}`,
      { file },
    );
  }

  const result = QuestionSetSchema.safeParse(data);
  if (!result.success) {
    const { message, path } = describeInvalid(file, result.error);
    throw new SetError('invalid', message, { file, path });
  }
  return result.data;
}

async function save(dir: string, name: string, set: QuestionSet): Promise<void> {
  if (!SET_NAME_RE.test(name)) {
    throw new SetError('badName', `Invalid set name: ${name}`);
  }

  const candidate: unknown = { ...set, name };
  const result = QuestionSetSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue ? formatPath(issue.path) : undefined;
    const message = `Invalid question set '${name}'${path ? `: ${path}` : ''} - ${issue?.message ?? 'invalid'}`;
    throw new SetError('invalid', message, { path });
  }

  await fs.mkdir(dir, { recursive: true });
  const file = nodePath.join(dir, `${name}.json`);
  const tmp = nodePath.join(dir, `${name}.json.tmp-${process.pid}-${randomUUID()}`);
  try {
    await fs.writeFile(tmp, `${JSON.stringify(result.data, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

function describeInvalid(file: string, error: ZodError): { message: string; path?: string } {
  const issue = error.issues[0];
  if (!issue) {
    return { message: `Invalid question set in ${file}: invalid` };
  }
  const path = formatPath(issue.path);
  const message = `Invalid question set in ${file}: ${path} - ${issue.message}`;
  return { message, path };
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
