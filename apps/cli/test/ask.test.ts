import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { JevError } from '@jev-ui/core';
import type { HistoryRecord, HistoryStore, QuestionSet, Request, RunResult } from '@jev-ui/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAsk, type Io } from '../src/ask.js';

const RESULT: RunResult = {
  answers: { urgent: { type: 'noul', noul: 0.5 } },
  model: 'jev-latest',
  usage: { inputTokens: 10, outputTokens: 2 },
  latencyMs: 5,
  costUsd: 0.0001,
};

function makeWriter() {
  const chunks: string[] = [];
  return {
    write(s: string): boolean {
      chunks.push(s);
      return true;
    },
    get output(): string {
      return chunks.join('');
    },
  };
}

function makeHistory(): HistoryStore & { records: HistoryRecord[] } {
  const records: HistoryRecord[] = [];
  return {
    file: '/dev/null',
    records,
    append: vi.fn(async (r: HistoryRecord) => {
      records.push(r);
    }),
    recent: vi.fn(async () => []),
  };
}

const tmpDirs: string[] = [];

async function makeSetsDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jev-cli-test-'));
  tmpDirs.push(dir);
  return dir;
}

async function writeSet(dir: string, name: string, set: QuestionSet): Promise<void> {
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(set), 'utf8');
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function baseIo(overrides: Partial<Io> = {}): Io {
  return {
    stdin: Readable.from([]) as Io['stdin'],
    stdout: makeWriter(),
    stderr: makeWriter(),
    env: { TYPESAFE_API_KEY: 'test-key' },
    cwd: process.cwd(),
    run: vi.fn(async () => RESULT),
    history: makeHistory(),
    ...overrides,
  };
}

describe('runAsk — set resolution', () => {
  it('loads a set by name from setsDir', async () => {
    const dir = await makeSetsDir();
    await writeSet(dir, 'triage', {
      name: 'triage',
      questions: { urgent: { type: 'noul', instructions: 'is this urgent?' } },
      state: 'default state',
    });
    const run = vi.fn(async () => RESULT);
    const io = baseIo({ run, stdin: Readable.from([]) as Io['stdin'] });
    (io.stdin as unknown as { isTTY: boolean }).isTTY = true;

    const code = await runAsk({ set: 'triage', setsDir: dir }, io);

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('loads a set given as a path', async () => {
    const dir = await makeSetsDir();
    const file = path.join(dir, 'support-triage.json');
    const set: QuestionSet = {
      name: 'support-triage',
      questions: { urgent: { type: 'noul', instructions: 'is this urgent?' } },
      state: 'the customer is upset',
    };
    await fs.writeFile(file, JSON.stringify(set), 'utf8');

    const run = vi.fn(async (request: Request) => {
      expect(request.state).toBe('the customer is upset');
      return RESULT;
    });
    const io = baseIo({ run });
    (io.stdin as unknown as { isTTY: boolean }).isTTY = true;

    const code = await runAsk({ set: file }, io);

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('runAsk — state precedence', () => {
  async function setupSet(state?: string): Promise<string> {
    const dir = await makeSetsDir();
    const set: QuestionSet = {
      name: 'triage',
      questions: { urgent: { type: 'noul', instructions: 'is this urgent?' } },
      ...(state !== undefined ? { state } : {}),
    };
    await writeSet(dir, 'triage', set);
    return dir;
  }

  it('uses piped stdin when present and not a TTY', async () => {
    const dir = await setupSet('set state');
    const run = vi.fn(async (request: Request) => {
      expect(request.state).toBe('piped state');
      return RESULT;
    });
    const stdin = Readable.from(['piped state']) as Io['stdin'];
    stdin.isTTY = false;
    const io = baseIo({ run, stdin });

    const code = await runAsk({ set: 'triage', setsDir: dir }, io);

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('prefers --state file over piped stdin', async () => {
    const dir = await setupSet('set state');
    const stateFile = path.join(dir, 'state.txt');
    await fs.writeFile(stateFile, 'file state', 'utf8');

    const run = vi.fn(async (request: Request) => {
      expect(request.state).toBe('file state');
      return RESULT;
    });
    const stdin = Readable.from(['piped state']) as Io['stdin'];
    stdin.isTTY = false;
    const io = baseIo({ run, stdin });

    const code = await runAsk({ set: 'triage', state: stateFile, setsDir: dir }, io);

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reads stdin via --state -', async () => {
    const dir = await setupSet('set state');
    const run = vi.fn(async (request: Request) => {
      expect(request.state).toBe('dash state');
      return RESULT;
    });
    const stdin = Readable.from(['dash state']) as Io['stdin'];
    const io = baseIo({ run, stdin });

    const code = await runAsk({ set: 'triage', state: '-', setsDir: dir }, io);

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('falls back to the set state on a TTY with no --state', async () => {
    const dir = await setupSet('set state');
    const run = vi.fn(async (request: Request) => {
      expect(request.state).toBe('set state');
      return RESULT;
    });
    const stdin = Readable.from([]) as Io['stdin'];
    stdin.isTTY = true;
    const io = baseIo({ run, stdin });

    const code = await runAsk({ set: 'triage', setsDir: dir }, io);

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('exits 2 with usage text when no state is available anywhere', async () => {
    const dir = await setupSet(undefined);
    const run = vi.fn(async () => RESULT);
    const stdin = Readable.from([]) as Io['stdin'];
    stdin.isTTY = true;
    const stderr = makeWriter();
    const io = baseIo({ run, stdin, stderr });

    const code = await runAsk({ set: 'triage', setsDir: dir }, io);

    expect(code).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(stderr.output.toLowerCase()).toContain('state');
  });

  it('reports a stdin read failure distinctly from a file read failure (--state -)', async () => {
    const dir = await setupSet('set state');
    const run = vi.fn(async () => RESULT);
    const stdin = new Readable({
      read() {
        this.destroy(new Error('stream boom'));
      },
    }) as Io['stdin'];
    const stderr = makeWriter();
    const io = baseIo({ run, stdin, stderr });

    const code = await runAsk({ set: 'triage', state: '-', setsDir: dir }, io);

    expect(code).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(stderr.output).toContain('Could not read state from stdin');
    expect(stderr.output).not.toContain('Could not read state file');
  });

  it('reports a stdin read failure distinctly from a file read failure (implicit piped stdin)', async () => {
    const dir = await setupSet('set state');
    const run = vi.fn(async () => RESULT);
    const stdin = new Readable({
      read() {
        this.destroy(new Error('stream boom'));
      },
    }) as Io['stdin'];
    stdin.isTTY = false;
    const stderr = makeWriter();
    const io = baseIo({ run, stdin, stderr });

    const code = await runAsk({ set: 'triage', setsDir: dir }, io);

    expect(code).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(stderr.output).toContain('Could not read state from stdin');
    expect(stderr.output).not.toContain('Could not read state file');
  });

  it('sends JSON-looking stdin as a parsed object', async () => {
    const dir = await setupSet('set state');
    const run = vi.fn(async (request: Request) => {
      expect(request.state).toEqual({ a: 1 });
      return RESULT;
    });
    const stdin = Readable.from(['{"a":1}']) as Io['stdin'];
    stdin.isTTY = false;
    const io = baseIo({ run, stdin });

    const code = await runAsk({ set: 'triage', setsDir: dir }, io);

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('runAsk — options and errors', () => {
  it('passes --model through to the request', async () => {
    const dir = await makeSetsDir();
    await writeSet(dir, 'triage', {
      name: 'triage',
      questions: { urgent: { type: 'noul', instructions: 'is this urgent?' } },
      state: 'set state',
    });
    const run = vi.fn(async (request: Request) => {
      expect(request.model).toBe('custom-model');
      return RESULT;
    });
    const stdin = Readable.from([]) as Io['stdin'];
    stdin.isTTY = true;
    const io = baseIo({ run, stdin });

    const code = await runAsk({ set: 'triage', setsDir: dir, model: 'custom-model' }, io);

    expect(code).toBe(0);
  });

  it('exits 2 and never calls run when no API key is configured', async () => {
    const dir = await makeSetsDir();
    await writeSet(dir, 'triage', {
      name: 'triage',
      questions: { urgent: { type: 'noul', instructions: 'is this urgent?' } },
      state: 'set state',
    });
    const run = vi.fn(async () => RESULT);
    const stdin = Readable.from([]) as Io['stdin'];
    stdin.isTTY = true;
    const stderr = makeWriter();
    const io = baseIo({ run, stdin, stderr, env: {} });

    const code = await runAsk({ set: 'triage', setsDir: dir }, io);

    expect(code).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(stderr.output).toContain('TYPESAFE_API_KEY');
  });

  it('exits 1 and writes "<kind>: <message> at <path>" on a validation error', async () => {
    const dir = await makeSetsDir();
    await writeSet(dir, 'triage', {
      name: 'triage',
      questions: { urgent: { type: 'noul', instructions: 'is this urgent?' } },
      state: 'set state',
    });
    const run = vi.fn(async () => {
      throw new JevError('validation', 'criteria must have at least one entry', {
        path: 'questions.urgent.criteria',
      });
    });
    const stdin = Readable.from([]) as Io['stdin'];
    stdin.isTTY = true;
    const stderr = makeWriter();
    const history = makeHistory();
    const io = baseIo({ run, stdin, stderr, history });

    const code = await runAsk({ set: 'triage', setsDir: dir }, io);

    expect(code).toBe(1);
    expect(stderr.output).toBe(
      'validation: criteria must have at least one entry at questions.urgent.criteria\n',
    );
    expect(history.records).toHaveLength(1);
    expect(history.records[0]?.error).toEqual({
      kind: 'validation',
      message: 'criteria must have at least one entry',
    });
    expect(history.records[0]?.setName).toBe('triage');
  });

  it('prints raw JSON that parses back to the result when --json is set', async () => {
    const dir = await makeSetsDir();
    await writeSet(dir, 'triage', {
      name: 'triage',
      questions: { urgent: { type: 'noul', instructions: 'is this urgent?' } },
      state: 'set state',
    });
    const run = vi.fn(async () => RESULT);
    const stdin = Readable.from([]) as Io['stdin'];
    stdin.isTTY = true;
    const stdout = makeWriter();
    const io = baseIo({ run, stdin, stdout });

    const code = await runAsk({ set: 'triage', setsDir: dir, json: true }, io);

    expect(code).toBe(0);
    expect(JSON.parse(stdout.output)).toEqual(RESULT);
  });

  it('appends history with the result on success', async () => {
    const dir = await makeSetsDir();
    await writeSet(dir, 'triage', {
      name: 'triage',
      questions: { urgent: { type: 'noul', instructions: 'is this urgent?' } },
      state: 'set state',
    });
    const run = vi.fn(async () => RESULT);
    const stdin = Readable.from([]) as Io['stdin'];
    stdin.isTTY = true;
    const history = makeHistory();
    const io = baseIo({ run, stdin, history });

    await runAsk({ set: 'triage', setsDir: dir }, io);

    expect(history.records).toHaveLength(1);
    expect(history.records[0]?.result).toEqual(RESULT);
    expect(history.records[0]?.setName).toBe('triage');
  });
});
