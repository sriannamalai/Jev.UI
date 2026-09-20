// Hands the current request off to the user's $EDITOR/$VISUAL as a temp JSON
// file (the TUI's equivalent of "JSON mode"), then reads back whatever they
// saved. No shell is involved: the configured editor command may itself
// carry arguments ("code --wait", "nvim -f"), so it's split on whitespace
// into a program and its args before spawning directly.
import { spawn as nodeSpawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEMP_FILE_NAME = 'request.json';

interface SpawnedProcess {
  once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

export interface OpenInEditorDeps {
  spawn(command: string, args: string[], options: { stdio: 'inherit' }): SpawnedProcess;
}

const defaultDeps: OpenInEditorDeps = { spawn: nodeSpawn };

/** Write `text` to a private temp file, hand it to `$VISUAL`/`$EDITOR`/`vi`
 * with the terminal attached (`stdio: 'inherit'`), and resolve with the
 * file's contents once the editor exits cleanly. The temp directory is
 * always removed afterward, success or failure. */
export async function openInEditor(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  deps: OpenInEditorDeps = defaultDeps,
): Promise<string> {
  // A whitespace-only $VISUAL/$EDITOR is not a command: fall through to the
  // next candidate (and ultimately `vi`) rather than spawning nothing.
  const command =
    [env.VISUAL, env.EDITOR, 'vi']
      .map((candidate) => (candidate ?? '').trim())
      .find((candidate) => candidate.length > 0) ?? 'vi';
  const [program, ...args] = command.split(/\s+/).filter((part) => part.length > 0);

  const dir = await mkdtemp(join(tmpdir(), 'jev-'));
  try {
    await chmod(dir, 0o700);
    const file = join(dir, TEMP_FILE_NAME);
    await writeFile(file, text, 'utf8');
    await chmod(file, 0o600);

    await new Promise<void>((resolve, reject) => {
      const child = deps.spawn(program!, [...args, file], { stdio: 'inherit' });
      child.once('error', (error) => {
        reject(error.code === 'ENOENT' ? new Error(`Editor not found: ${program}`) : error);
      });
      child.once('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`Editor was killed by signal ${signal}`));
          return;
        }
        if (code !== 0) {
          reject(new Error(`Editor exited with code ${code}`));
          return;
        }
        resolve();
      });
    });

    return await readFile(file, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
