// Boots the real TUI: builds production `TuiDeps`, refuses to start on a
// non-TTY stdin (pipes go through `jev ask` instead), then renders `<App>`
// and waits for it to exit. `stdin`/`stderr` are overridable so tests can
// exercise the refusal path without touching the real process.
import { access, writeFile } from 'node:fs/promises';
import { render } from 'ink';
import {
  createHistory,
  createSets,
  listModels,
  resolveApiKey,
  resolveSetsDir,
  run,
} from '@jev-ui/core';
import { openInEditor } from './editor.js';
import { App } from './App.js';
import type { TuiDeps } from './App.js';

export interface RunTuiOptions {
  setsDir?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: { isTTY?: boolean };
  stderr?: { write(s: string): unknown };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
    openEditor: (text) => openInEditor(text, env),
    writeFile: (path, text) => writeFile(path, text, 'utf8'),
    fileExists,
    cwd: () => process.cwd(),
    env,
  };

  // Ink's default `exitOnCtrlC: true` force-exits the process on the raw
  // Ctrl+C byte before any component's own `useInput` sees it (confirmed
  // in ink's App.js: its internal handler runs ahead of user listeners).
  // `App`'s quit flow needs to see Ctrl+C itself to ask for confirmation
  // when there are unsaved changes, so that default is turned off here.
  const instance = render(<App deps={deps} />, { exitOnCtrlC: false });
  await instance.waitUntilExit();
}
