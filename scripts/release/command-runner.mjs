import { spawn as nodeSpawn } from 'node:child_process';

const SAFE_CMD_ARGUMENT = /^[A-Za-z0-9@._:/=+-]+$/;

export function resolvePnpmInvocation(args, environment = {}) {
  const platform = environment.platform ?? process.platform;
  const npmExecpath = Object.hasOwn(environment, 'npmExecpath')
    ? environment.npmExecpath
    : process.env.npm_execpath;
  const comSpec = environment.comSpec ?? process.env.ComSpec;
  const execPath = environment.execPath ?? process.execPath;
  if (npmExecpath) {
    return /\.[cm]?js$/i.test(npmExecpath)
      ? { command: execPath, args: [npmExecpath, ...args] }
      : { command: npmExecpath, args };
  }

  if (platform === 'win32') {
    for (const argument of args) {
      if (!SAFE_CMD_ARGUMENT.test(argument)) {
        throw new Error(`unsafe pnpm argument for Windows cmd fallback: ${argument}`);
      }
    }
    return {
      command: comSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', ...args],
    };
  }

  return { command: 'pnpm', args };
}

export function runCommand(command, args, options = {}, dependencies = {}) {
  const spawn = dependencies.spawn ?? nodeSpawn;
  const setTimer = dependencies.setTimeout ?? setTimeout;
  const clearTimer = dependencies.clearTimeout ?? clearTimeout;
  const { timeout: timeoutMs = 120_000, ...spawnOptions } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, spawnOptions);
    let settled = false;
    const timeout = setTimer(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Timed out: ${command} ${args.join(' ')}`));
    }, timeoutMs);

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimer(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimer(timeout);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${String(code)}${signal ? ` (${signal})` : ''}`));
    });
  });
}
