import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePnpmInvocation, runCommand } from './command-runner.mjs';

test('direct Windows pnpm fallback runs the cmd wrapper through ComSpec', () => {
  assert.deepEqual(
    resolvePnpmInvocation(['build'], {
      platform: 'win32',
      npmExecpath: undefined,
      comSpec: 'C:\\Windows\\System32\\cmd.exe',
      execPath: 'C:\\node.exe',
    }),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', 'build'],
    },
  );
});

test('Windows cmd fallback rejects shell metacharacters instead of interpolating them', () => {
  assert.throws(
    () =>
      resolvePnpmInvocation(['build', '& whoami'], {
        platform: 'win32',
        npmExecpath: undefined,
        comSpec: 'cmd.exe',
        execPath: 'node.exe',
      }),
    /unsafe pnpm argument/,
  );
});

test('runCommand clears its timeout when spawn emits an error', async () => {
  let onError;
  const timer = { id: 'timer' };
  const cleared = [];
  const child = {
    kill() {},
    once(event, listener) {
      if (event === 'error') onError = listener;
      return this;
    },
  };

  const result = runCommand(
    'missing',
    [],
    {},
    {
      spawn: () => child,
      setTimeout: () => timer,
      clearTimeout: (value) => cleared.push(value),
    },
  );
  onError(new Error('spawn ENOENT'));

  await assert.rejects(result, /spawn ENOENT/);
  assert.deepEqual(cleared, [timer]);
});
