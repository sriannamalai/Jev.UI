import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { runAsk as defaultRunAsk } from './ask.js';
import type { AskOptions, Io } from './ask.js';
import { runServe as defaultRunServe } from './serve.js';
import type { ServeOptions } from './serve.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export type RunTui = (io: Io) => void | Promise<void>;

export interface BinDeps {
  runAsk: typeof defaultRunAsk;
  runServe: typeof defaultRunServe;
  runTui: RunTui;
  io: Io;
}

function defaultIo(): Io {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: process.cwd(),
  };
}

/** Placeholder until the TUI (a later task) replaces it. */
function defaultRunTui(io: Io): void {
  io.stderr.write('TUI not built yet\n');
  process.exitCode = 1;
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    const err = new InvalidArgumentError(
      `port must be an integer between 1 and 65535, got "${value}"`,
    );
    err.exitCode = 2;
    throw err;
  }
  return parsed;
}

/** Build the `jev` commander program. Exposed for tests; call `.exitOverride()` there. */
export function buildProgram(deps: Partial<BinDeps> = {}): Command {
  const runAskFn = deps.runAsk ?? defaultRunAsk;
  const runServeFn = deps.runServe ?? defaultRunServe;
  const runTuiFn = deps.runTui ?? defaultRunTui;
  const io = deps.io ?? defaultIo();

  const program = new Command();
  program
    .name('jev')
    .description('Jev.UI — a workbench for TypeSafe Jev question sets')
    .version(version)
    .option('--sets-dir <dir>', 'directory containing question sets');

  program
    .command('ask <set>')
    .description('Run a question set against Jev')
    .option('--state <file>', 'state file to send (use - for stdin)')
    .option('--model <id>', 'override the model')
    .option('--json', 'print the raw JSON result')
    .action(
      async (
        set: string,
        cmdOpts: { state?: string; model?: string; json?: boolean },
        command: Command,
      ) => {
        const globalOpts = command.optsWithGlobals() as { setsDir?: string };
        const opts: AskOptions = {
          set,
          ...(cmdOpts.state !== undefined ? { state: cmdOpts.state } : {}),
          ...(cmdOpts.model !== undefined ? { model: cmdOpts.model } : {}),
          ...(cmdOpts.json !== undefined ? { json: cmdOpts.json } : {}),
          ...(globalOpts.setsDir !== undefined ? { setsDir: globalOpts.setsDir } : {}),
        };
        const code = await runAskFn(opts, io);
        process.exitCode = code;
      },
    );

  program
    .command('serve')
    .description('Start the local server and open a browser to it')
    .option('--port <n>', 'port to listen on', parsePort)
    .option('--no-open', 'do not open a browser')
    .action(async (cmdOpts: { port?: number; open?: boolean }, command: Command) => {
      const globalOpts = command.optsWithGlobals() as { setsDir?: string };
      const opts: ServeOptions = {
        ...(cmdOpts.port !== undefined ? { port: cmdOpts.port } : {}),
        open: cmdOpts.open !== false,
        ...(globalOpts.setsDir !== undefined ? { setsDir: globalOpts.setsDir } : {}),
      };
      await runServeFn(opts);
    });

  program
    .command('tui', { isDefault: true, hidden: true })
    .description('Launch the interactive TUI')
    .action(async () => {
      await runTuiFn(io);
    });

  return program;
}

function isEntryPoint(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return realpathSync(invoked) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const program = buildProgram();
  void program.parseAsync(process.argv);
}
