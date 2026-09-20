// Boots the real TUI: builds production `TuiDeps`, refuses to start on a
// non-TTY stdin (pipes go through `jev ask` instead), then renders `<App>`
// and waits for it to exit. `stdin`/`stderr` are overridable so tests can
// exercise the refusal path without touching the real process.
import { render } from 'ink';
import {
  createHistory,
  createSets,
  listModels,
  resolveApiKey,
  resolveSetsDir,
  run,
} from '@jev-ui/core';
import { App } from './App.js';
import type { TuiDeps } from './App.js';

export interface RunTuiOptions {
  setsDir?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: { isTTY?: boolean };
  stderr?: { write(s: string): unknown };
}

async function notImplementedEditor(): Promise<string> {
  throw new Error('not implemented');
}

export async function runTui(opts: RunTuiOptions = {}): Promise<void> {
  const env = opts.env ?? process.env;
  const stdin = opts.stdin ?? process.stdin;
  const stderr = opts.stderr ?? process.stderr;

  if (stdin.isTTY !== true) {
    stderr.write('jev: the interactive UI needs a terminal — use "jev ask" for pipes\n');
    process.exitCode = 2;
    return;
  }

  const deps: TuiDeps = {
    run,
    listModels,
    sets: createSets(resolveSetsDir(opts.setsDir, env)),
    history: createHistory(),
    keyConfigured: resolveApiKey(undefined, env) !== undefined,
    openEditor: notImplementedEditor,
  };

  const instance = render(<App deps={deps} />);
  await instance.waitUntilExit();
}
