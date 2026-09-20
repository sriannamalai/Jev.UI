import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram, type BinDeps } from '../src/bin.js';
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

function program(deps: BinDeps, writeOut: (s: string) => void = () => undefined) {
  const p = buildProgram(deps);
  // Subcommands snapshot exitOverride/configureOutput at creation time, so apply to each.
  for (const cmd of [p, ...p.commands]) {
    cmd.exitOverride();
    cmd.configureOutput({ writeOut, writeErr: () => undefined });
  }
  return p;
}

describe('buildProgram', () => {
  it('wires ask with --json/--model/--state', async () => {
    const deps = makeDeps();
    const p = program(deps);
    await p.parseAsync(['ask', 'support-triage', '--json', '--model', 'm', '--state', 'f'], {
      from: 'user',
    });
    expect(deps.runAsk).toHaveBeenCalledWith(
      { set: 'support-triage', json: true, model: 'm', state: 'f' },
      deps.io,
    );
  });

  it('accepts a global --sets-dir before the subcommand', async () => {
    const deps = makeDeps();
    const p = program(deps);
    await p.parseAsync(['--sets-dir', 'd', 'ask', 'support-triage'], { from: 'user' });
    expect(deps.runAsk).toHaveBeenCalledWith({ set: 'support-triage', setsDir: 'd' }, deps.io);
  });

  it('accepts a global --sets-dir after the subcommand', async () => {
    const deps = makeDeps();
    const p = program(deps);
    await p.parseAsync(['ask', 'support-triage', '--sets-dir', 'd'], { from: 'user' });
    expect(deps.runAsk).toHaveBeenCalledWith({ set: 'support-triage', setsDir: 'd' }, deps.io);
  });

  it('sets process.exitCode from runAsk', async () => {
    const deps = makeDeps({ runAsk: vi.fn(async () => 2 as const) });
    const p = program(deps);
    const prev = process.exitCode;
    await p.parseAsync(['ask', 'support-triage'], { from: 'user' });
    expect(process.exitCode).toBe(2);
    process.exitCode = prev;
  });

  it('wires serve with --port and --no-open', async () => {
    const deps = makeDeps();
    const p = program(deps);
    await p.parseAsync(['serve', '--port', '5000', '--no-open'], { from: 'user' });
    expect(deps.runServe).toHaveBeenCalledWith({ port: 5000, open: false });
  });

  it('rejects a non-numeric --port with exit code 2', async () => {
    const deps = makeDeps();
    const p = program(deps);
    await expect(p.parseAsync(['serve', '--port', 'abc'], { from: 'user' })).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(deps.runServe).not.toHaveBeenCalled();
  });

  it('runs the TUI when no arguments are given', async () => {
    const deps = makeDeps();
    const p = program(deps);
    await p.parseAsync([], { from: 'user' });
    expect(deps.runTui).toHaveBeenCalledWith(deps.io);
  });

  it('prints the CLI package version for --version', async () => {
    const deps = makeDeps();
    let out = '';
    const p = program(deps, (s) => {
      out += s;
    });
    await expect(p.parseAsync(['--version'], { from: 'user' })).rejects.toMatchObject({
      code: 'commander.version',
    });
    const pkg = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'),
    ) as {
      version: string;
    };
    expect(out.trim()).toBe(pkg.version);
  });
});
