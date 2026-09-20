import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, type BinDeps } from '../src/bin.js';
import type { Io } from '../src/ask.js';

function baseIo(): Io {
  return {
    stdin: Object.assign(Readable.from([]), { isTTY: true }),
    stdout: { write: vi.fn(() => true) },
    stderr: { write: vi.fn(() => true) },
    env: {},
    cwd: '/repo',
  };
}

function makeDeps(overrides: Partial<BinDeps> = {}): BinDeps {
  return {
    runAsk: vi.fn(async () => 0 as const),
    runServe: vi.fn(async () => undefined),
    runTui: vi.fn(async () => undefined),
    io: baseIo(),
    ...overrides,
  };
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let out: string;
let err: string;
let prevExitCode: NodeJS.Process['exitCode'];

beforeEach(() => {
  prevExitCode = process.exitCode;
  process.exitCode = undefined;
  out = '';
  err = '';
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${String(code)}) called`);
  }) as never);
  outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});

afterEach(() => {
  exitSpy.mockRestore();
  outSpy.mockRestore();
  errSpy.mockRestore();
  process.exitCode = prevExitCode;
});

const pkgVersion = (
  JSON.parse(readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8')) as {
    version: string;
  }
).version;

describe('main', () => {
  it('wires ask with --json/--model/--state', async () => {
    const deps = makeDeps();
    await main(
      ['node', 'jev', 'ask', 'support-triage', '--json', '--model', 'm', '--state', 'f'],
      deps,
    );
    expect(deps.runAsk).toHaveBeenCalledWith(
      { set: 'support-triage', json: true, model: 'm', state: 'f' },
      deps.io,
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('accepts a global --sets-dir before the ask subcommand', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', '--sets-dir', 'd', 'ask', 'support-triage'], deps);
    expect(deps.runAsk).toHaveBeenCalledWith({ set: 'support-triage', setsDir: 'd' }, deps.io);
  });

  it('accepts a global --sets-dir after the ask subcommand', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', 'ask', 'support-triage', '--sets-dir', 'd'], deps);
    expect(deps.runAsk).toHaveBeenCalledWith({ set: 'support-triage', setsDir: 'd' }, deps.io);
  });

  it('sets process.exitCode from runAsk', async () => {
    const deps = makeDeps({ runAsk: vi.fn(async () => 2 as const) });
    await main(['node', 'jev', 'ask', 'support-triage'], deps);
    expect(process.exitCode).toBe(2);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('sets exitCode 1 and prints "unexpected: <message>" when an action rejects', async () => {
    const deps = makeDeps({
      runAsk: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await main(['node', 'jev', 'ask', 'support-triage'], deps);
    expect(process.exitCode).toBe(1);
    expect(err).toContain('unexpected: boom');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('wires serve with --port and --no-open', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', 'serve', '--port', '5000', '--no-open'], deps);
    expect(deps.runServe).toHaveBeenCalledWith({ port: 5000, open: false });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('accepts a global --sets-dir before the serve subcommand', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', '--sets-dir', 'd', 'serve', '--no-open'], deps);
    expect(deps.runServe).toHaveBeenCalledWith({ open: false, setsDir: 'd' });
  });

  it('accepts a global --sets-dir after the serve subcommand', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', 'serve', '--sets-dir', 'd', '--no-open'], deps);
    expect(deps.runServe).toHaveBeenCalledWith({ open: false, setsDir: 'd' });
  });

  it('rejects a non-numeric --port with exit code 2 and never calls process.exit', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', 'serve', '--port', 'abc'], deps);
    expect(process.exitCode).toBe(2);
    expect(deps.runServe).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('runs the TUI when no arguments are given', async () => {
    const deps = makeDeps();
    await main(['node', 'jev'], deps);
    expect(deps.runTui).toHaveBeenCalledWith(deps.io);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('prints the CLI package version and sets exit code 0 for --version', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', '--version'], deps);
    expect(process.exitCode).toBe(0);
    expect(out.trim()).toBe(pkgVersion);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('sets exit code 0 for --help', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', '--help'], deps);
    expect(process.exitCode).toBe(0);
    expect(out).toContain('Usage:');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('sets exit code 2 for an unknown option', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', '--bogus'], deps);
    expect(process.exitCode).toBe(2);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('sets exit code 2 for an unknown command', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', 'frobnicate'], deps);
    expect(process.exitCode).toBe(2);
    expect(deps.runTui).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('sets exit code 2 for `help` on an unknown subcommand', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', 'help', 'nope'], deps);
    expect(process.exitCode).toBe(2);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('sets exit code 0 for bare `help`', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', 'help'], deps);
    expect(process.exitCode).toBe(0);
    expect(out).toContain('Usage:');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('sets exit code 0 for `help ask`', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', 'help', 'ask'], deps);
    expect(process.exitCode).toBe(0);
    expect(out).toContain('Usage:');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('sets exit code 0 for `ask --help`', async () => {
    const deps = makeDeps();
    await main(['node', 'jev', 'ask', '--help'], deps);
    expect(process.exitCode).toBe(0);
    expect(out).toContain('Usage:');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
