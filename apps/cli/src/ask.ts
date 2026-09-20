import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';
import {
  JevError,
  QuestionSetSchema,
  SetError,
  createHistory,
  createSets,
  requestFromSet,
  resolveApiKey,
  resolveSetsDir,
  run,
} from '@jev-ui/core';
import type { HistoryStore, QuestionSet, Text } from '@jev-ui/core';
import { formatResult } from './format.js';

export interface AskOptions {
  set: string;
  state?: string;
  model?: string;
  json?: boolean;
  setsDir?: string;
}

export interface Io {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
  env: NodeJS.ProcessEnv;
  cwd: string;
  run?: typeof run;
  history?: HistoryStore;
}

function isPathLike(set: string): boolean {
  return set.includes('/') || set.endsWith('.json');
}

async function readStdin(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isTTYStdin(stdin: Io['stdin']): boolean {
  return stdin.isTTY === true;
}

function isTTYStdout(stdout: Io['stdout']): boolean {
  return (stdout as { isTTY?: boolean }).isTTY === true;
}

function hasNonEmptyState(state: Text | undefined): state is Text {
  if (state === undefined) return false;
  return !(typeof state === 'string' && state.trim().length === 0);
}

/** JSON-looking text (an object or array) is sent as JSON; anything else is sent as a string. */
function parseStateText(raw: string): Text {
  const trimmed = raw.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Text;
    }
  } catch {
    // Not JSON — fall through to the plain-string form.
  }
  return trimmed;
}

function describeError(err: JevError): string {
  return err.path ? `${err.kind}: ${err.message} at ${err.path}` : `${err.kind}: ${err.message}`;
}

async function resolveSet(
  opts: AskOptions,
  io: Io,
): Promise<{ set: QuestionSet; setName?: string } | { exitCode: 2 }> {
  if (isPathLike(opts.set)) {
    const file = nodePath.resolve(io.cwd, opts.set);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      io.stderr.write(`Could not read question set: ${opts.set}\n`);
      return { exitCode: 2 };
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (err) {
      io.stderr.write(
        `Invalid JSON in ${opts.set}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return { exitCode: 2 };
    }
    const parsed = QuestionSetSchema.safeParse(data);
    if (!parsed.success) {
      io.stderr.write(`invalid: question set ${opts.set} does not match the expected shape\n`);
      return { exitCode: 2 };
    }
    return { set: parsed.data };
  }

  const sets = createSets(resolveSetsDir(opts.setsDir, io.env, io.cwd));
  try {
    const set = await sets.load(opts.set);
    return { set, setName: opts.set };
  } catch (err) {
    if (err instanceof SetError) {
      io.stderr.write(`${err.code}: ${err.message}${err.path ? ` at ${err.path}` : ''}\n`);
      return { exitCode: 2 };
    }
    io.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return { exitCode: 2 };
  }
}

interface StateOutcome {
  text?: Text;
  /** true once resolveState has already written a stderr message for this outcome. */
  reported?: boolean;
}

async function resolveState(opts: AskOptions, io: Io, set: QuestionSet): Promise<StateOutcome> {
  if (opts.state !== undefined) {
    if (opts.state === '-') {
      let raw: string;
      try {
        raw = await readStdin(io.stdin);
      } catch {
        io.stderr.write('Could not read state from stdin\n');
        return { reported: true };
      }
      return { text: parseStateText(raw) };
    }
    let raw: string;
    try {
      raw = await fs.readFile(nodePath.resolve(io.cwd, opts.state), 'utf8');
    } catch {
      io.stderr.write(`Could not read state file: ${opts.state}\n`);
      return { reported: true };
    }
    return { text: parseStateText(raw) };
  }

  if (!isTTYStdin(io.stdin)) {
    let piped: string;
    try {
      piped = await readStdin(io.stdin);
    } catch {
      io.stderr.write('Could not read state from stdin\n');
      return { reported: true };
    }
    if (piped.trim().length > 0) {
      return { text: parseStateText(piped) };
    }
  }

  if (hasNonEmptyState(set.state)) {
    return { text: set.state };
  }

  return {};
}

export async function runAsk(opts: AskOptions, io: Io): Promise<0 | 1 | 2> {
  const runFn = io.run ?? run;
  const history = io.history ?? createHistory();

  const setResult = await resolveSet(opts, io);
  if ('exitCode' in setResult) return setResult.exitCode;
  const { set, setName } = setResult;

  const outcome = await resolveState(opts, io, set);
  if (outcome.reported) return 2;
  const state = outcome.text;
  if (state === undefined) {
    io.stderr.write(
      'usage: no state available; pass --state, pipe input on stdin, or set "state" in the question set\n',
    );
    return 2;
  }

  const apiKey = resolveApiKey(undefined, io.env);
  if (apiKey === undefined) {
    io.stderr.write(
      'TYPESAFE_API_KEY is not set. Set it in your environment before running jev ask.\n',
    );
    return 2;
  }

  const request = requestFromSet(set, { state, model: opts.model });

  try {
    const result = await runFn(request, { apiKey });
    await history.append({
      ts: new Date().toISOString(),
      request,
      result,
      ...(setName !== undefined ? { setName } : {}),
    });
    if (opts.json) {
      io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const color = io.env.NO_COLOR === undefined && isTTYStdout(io.stdout);
      io.stdout.write(`${formatResult(result, { color })}\n`);
    }
    return 0;
  } catch (err) {
    if (err instanceof JevError) {
      await history.append({
        ts: new Date().toISOString(),
        request,
        error: { kind: err.kind, message: err.message },
        ...(setName !== undefined ? { setName } : {}),
      });
      io.stderr.write(`${describeError(err)}\n`);
      return 1;
    }
    throw err;
  }
}
