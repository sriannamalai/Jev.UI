import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const sourceExecutable = process.argv[2];
if (sourceExecutable === undefined || process.argv.length !== 3) {
  throw new Error('usage: node scripts/release/smoke-binary.mjs <executable>');
}

function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`process timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function run(executable, args, options) {
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  child.stdin.end(options.input ?? '');
  const status = await waitForExit(child);
  return { ...status, stdout, stderr };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address !== null && typeof address !== 'string');
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function fetchUntilReady(url, child) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `server exited before startup: ${JSON.stringify({ code: child.exitCode, signal: child.signalCode })}`,
      );
    }
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready: ${String(lastError)}`);
}

function assetPath(text, expression, label) {
  const match = expression.exec(text);
  assert(match?.[1], `${label} reference missing`);
  return match[1];
}

const metadata = JSON.parse(
  await readFile(
    path.join(path.dirname(path.resolve(sourceExecutable)), 'build-metadata.json'),
    'utf8',
  ),
);
const root = await mkdtemp(path.join(tmpdir(), 'jev binary smoke with spaces '));

try {
  const cwd = path.join(root, 'unrelated working directory');
  const movedDir = path.join(root, 'moved executable');
  const tempRoot = path.join(root, 'runtime temp');
  const home = path.join(root, 'empty home');
  const setsDir = path.join(root, 'sets');
  await Promise.all([cwd, movedDir, tempRoot, home, setsDir].map((directory) => mkdir(directory)));
  const executable = path.join(
    movedDir,
    process.platform === 'win32' ? 'jev renamed.exe' : 'jev renamed',
  );
  await copyFile(sourceExecutable, executable);
  await chmod(executable, 0o755);
  await assert.rejects(readFile(path.join(cwd, 'node_modules')));

  const env = {
    PATH:
      process.platform === 'win32'
        ? String(process.env.SystemRoot) + '\\System32'
        : '/usr/bin:/bin',
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    NO_COLOR: '1',
  };

  const version = await run(executable, ['--version'], { cwd, env });
  assert.equal(version.code, 0, version.stderr);
  assert.equal(version.stdout.trim(), metadata.version);

  const help = await run(executable, ['--help'], { cwd, env });
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /Usage: jev/);

  const unknown = await run(executable, ['frobnicate'], { cwd, env });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /^error:/i);

  const missingSet = await run(
    executable,
    ['ask', 'definitely-missing', '--state', 'hello', '--sets-dir', setsDir],
    { cwd, env },
  );
  assert.equal(missingSet.code, 2);
  assert.match(missingSet.stderr, /Question set not found/);

  await writeFile(
    path.join(setsDir, 'smoke.json'),
    JSON.stringify({
      name: 'smoke',
      questions: {
        useful: { type: 'noul', instructions: 'The text is useful' },
      },
    }),
  );
  const stateFile = path.join(root, 'state.txt');
  await writeFile(stateFile, 'hello');
  const missingKey = await run(
    executable,
    ['ask', 'smoke', '--state', stateFile, '--sets-dir', setsDir],
    { cwd, env },
  );
  assert.equal(missingKey.code, 2);
  assert.match(missingKey.stderr, /TYPESAFE_API_KEY is not set/);

  const nonTty = await run(executable, [], { cwd, env });
  assert.equal(nonTty.code, 2);
  assert.match(nonTty.stderr, /interactive UI needs a terminal/);
  assert.deepEqual(await readdir(tempRoot), [], 'short-lived commands left extracted files behind');

  const port = await freePort();
  const server = spawn(
    executable,
    ['serve', '--no-open', '--port', String(port), '--sets-dir', setsDir],
    { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let serverStdout = '';
  let serverStderr = '';
  server.stdout.setEncoding('utf8').on('data', (chunk) => (serverStdout += chunk));
  server.stderr.setEncoding('utf8').on('data', (chunk) => (serverStderr += chunk));
  const serverExit = waitForExit(server, 20_000);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthResponse = await fetchUntilReady(baseUrl, server);
    assert.deepEqual(await healthResponse.json(), {
      keyConfigured: false,
      version: metadata.version,
      setsDir,
    });

    const indexResponse = await fetch(`${baseUrl}/`);
    assert.equal(indexResponse.status, 200);
    const index = await indexResponse.text();
    assert.match(index, /<div id="root"><\/div>/);

    const script = await fetch(`${baseUrl}${assetPath(index, /src="([^"]+\.js)"/, 'JavaScript')}`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
    assert((await script.arrayBuffer()).byteLength > 1000);

    const cssPath = assetPath(index, /href="([^"]+\.css)"/, 'CSS');
    const cssResponse = await fetch(`${baseUrl}${cssPath}`);
    assert.equal(cssResponse.status, 200);
    assert.match(cssResponse.headers.get('content-type') ?? '', /css/);
    const css = await cssResponse.text();
    const fontName = assetPath(css, /url\(([^)]+\.woff2)\)/, 'font').replaceAll('"', '');
    const font = await fetch(new URL(fontName, new URL(cssPath, baseUrl)).href);
    assert.equal(font.status, 200);
    assert((await font.arrayBuffer()).byteLength > 1000);

    const api404 = await fetch(`${baseUrl}/api/not-a-route`);
    assert.equal(api404.status, 404);
    assert.deepEqual(await api404.json(), {
      error: { kind: 'unexpected', message: 'not found' },
    });
    assert.match(serverStdout, new RegExp(`Jev\\.UI running at http://127\\.0\\.0\\.1:${port}`));
    assert.match(serverStderr, /TYPESAFE_API_KEY is not set/);
  } finally {
    server.kill('SIGTERM');
    await serverExit;
  }

  if (process.platform !== 'win32') {
    assert.deepEqual(await readdir(tempRoot), [], 'server shutdown left extracted files behind');
  }
  process.stdout.write(
    `binary smoke passed: ${metadata.os}/${metadata.arch}, ${metadata.binarySize} bytes\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
