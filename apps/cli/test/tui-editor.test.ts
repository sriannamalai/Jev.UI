import { EventEmitter } from 'node:events';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { openInEditor } from '../src/tui/editor.js';

interface FakeChild extends EventEmitter {
  file: string;
}

function fakeSpawn(onSpawn?: (file: string) => void) {
  const calls: { command: string; args: string[] }[] = [];
  const children: FakeChild[] = [];
  const spawn = vi.fn((command: string, args: string[]) => {
    calls.push({ command, args });
    const file = args[args.length - 1]!;
    const child = new EventEmitter() as FakeChild;
    child.file = file;
    children.push(child);
    if (onSpawn) onSpawn(file);
    return child;
  });
  return { spawn, calls, children };
}

/** `openInEditor` does real (mkdtemp/chmod/writeFile) I/O before it spawns —
 * poll rather than assume a fixed delay is enough for it to have reached the
 * spawn call. */
async function waitForSpawn(calls: unknown[]): Promise<void> {
  await vi.waitFor(
    () => {
      if (calls.length === 0) throw new Error('spawn not called yet');
    },
    { timeout: 2000, interval: 5 },
  );
}

describe('openInEditor', () => {
  it('writes the text to a fresh temp file and invokes VISUAL, splitting args', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor('{"a":1}', { VISUAL: 'code --wait', EDITOR: 'vi' }, { spawn });
    await waitForSpawn(calls);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('code');
    const file = calls[0]!.args[calls[0]!.args.length - 1]!;
    expect(calls[0]!.args).toEqual(['--wait', file]);
    expect(file.endsWith('request.json')).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('{"a":1}');

    children[0]!.emit('exit', 0, null);
    await expect(promise).resolves.toBe('{"a":1}');
  });

  it('a whitespace-only VISUAL falls through to EDITOR', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor('x', { VISUAL: '   ', EDITOR: 'nano' }, { spawn });
    await waitForSpawn(calls);
    expect(calls[0]!.command).toBe('nano');
    children[0]!.emit('exit', 0, null);
    await promise;
  });

  it('a whitespace-only VISUAL and EDITOR fall through to vi', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor('x', { VISUAL: ' ', EDITOR: '\t' }, { spawn });
    await waitForSpawn(calls);
    expect(calls[0]!.command).toBe('vi');
    children[0]!.emit('exit', 0, null);
    await promise;
  });

  it('VISUAL wins over EDITOR', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor(
      'x',
      { VISUAL: 'visual-editor', EDITOR: 'editor-editor' },
      { spawn },
    );
    await waitForSpawn(calls);
    expect(calls[0]!.command).toBe('visual-editor');
    children[0]!.emit('exit', 0, null);
    await promise;
  });

  it('falls back to vi when neither VISUAL nor EDITOR is set', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor('x', {}, { spawn });
    await waitForSpawn(calls);
    expect(calls[0]!.command).toBe('vi');
    children[0]!.emit('exit', 0, null);
    await promise;
  });

  it('falls back to notepad.exe on Windows when neither VISUAL nor EDITOR is set', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor('x', {}, { spawn, platform: 'win32' });
    await waitForSpawn(calls);
    expect(calls[0]!.command).toBe('notepad.exe');
    children[0]!.emit('exit', 0, null);
    await promise;
  });

  it('keeps VISUAL ahead of EDITOR and the Windows fallback', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor(
      'x',
      { VISUAL: 'visual-editor', EDITOR: 'editor-editor' },
      { spawn, platform: 'win32' },
    );
    await waitForSpawn(calls);
    expect(calls[0]!.command).toBe('visual-editor');
    children[0]!.emit('exit', 0, null);
    await promise;
  });

  it('resolves with the rewritten file contents after a successful exit', async () => {
    const { spawn, calls, children } = fakeSpawn((file) => {
      void writeFile(file, 'rewritten contents');
    });
    const promise = openInEditor('original', { EDITOR: 'ed' }, { spawn });
    await waitForSpawn(calls);
    children[0]!.emit('exit', 0, null);
    await expect(promise).resolves.toBe('rewritten contents');
  });

  it('rejects on a non-zero exit code', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor('x', { EDITOR: 'ed' }, { spawn });
    await waitForSpawn(calls);
    children[0]!.emit('exit', 1, null);
    await expect(promise).rejects.toThrow('Editor exited with code 1');
  });

  it('rejects when killed by a signal', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor('x', { EDITOR: 'ed' }, { spawn });
    await waitForSpawn(calls);
    children[0]!.emit('exit', null, 'SIGTERM');
    await expect(promise).rejects.toThrow(/SIGTERM/);
  });

  it('rejects with "Editor not found: <program>" for ENOENT', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor('x', { EDITOR: 'nope' }, { spawn });
    await waitForSpawn(calls);
    children[0]!.emit('error', Object.assign(new Error('spawn nope ENOENT'), { code: 'ENOENT' }));
    await expect(promise).rejects.toThrow('Editor not found: nope');
  });

  it('removes the temp dir in every case, including failure', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor('x', { EDITOR: 'ed' }, { spawn });
    await waitForSpawn(calls);
    const file = calls[0]!.args[calls[0]!.args.length - 1]!;
    const dir = file.slice(0, file.lastIndexOf('/'));
    children[0]!.emit('exit', 1, null);
    await expect(promise).rejects.toThrow();
    await expect(stat(dir)).rejects.toThrow();
  });

  it('removes the temp dir after a successful run too', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor('x', { EDITOR: 'ed' }, { spawn });
    await waitForSpawn(calls);
    const file = calls[0]!.args[calls[0]!.args.length - 1]!;
    const dir = file.slice(0, file.lastIndexOf('/'));
    children[0]!.emit('exit', 0, null);
    await promise;
    await expect(stat(dir)).rejects.toThrow();
  });

  it('creates the temp file with mode 0o600', async () => {
    const { spawn, calls, children } = fakeSpawn();
    const promise = openInEditor('x', { EDITOR: 'ed' }, { spawn });
    await waitForSpawn(calls);
    const file = calls[0]!.args[calls[0]!.args.length - 1]!;
    const stats = await stat(file);
    expect(stats.mode & 0o777).toBe(0o600);
    children[0]!.emit('exit', 0, null);
    await promise;
  });

  it('spawns with stdio inherit', async () => {
    const calls: unknown[] = [];
    const spawn = vi.fn((command: string, args: string[], options: unknown) => {
      calls.push(options);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    });
    await openInEditor('x', { EDITOR: 'ed' }, { spawn });
    expect(calls[0]).toEqual({ stdio: 'inherit' });
  });
});
