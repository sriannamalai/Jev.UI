// Worker-scoped Playwright fixtures that stand up the real stack once per
// worker (`workers: 1` in playwright.config.ts, so once per run):
//   stub    -> the stubbed upstream (node:http, see stub-upstream.mjs)
//   setsDir -> a temp dir seeded with a copy of the repo's support-triage set
//   server  -> `jev serve` (apps/cli/dist/bin.js) pointed at both, auto-started
//
// All three run in the SAME process as the test file (a worker fixture, not
// Playwright's separate-process globalSetup/globalTeardown), so `stub.requests`
// is a live array the spec can read directly after driving the browser.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { test as base, expect } from '@playwright/test';
import { startStub } from './stub-upstream.mjs';

type Stub = Awaited<ReturnType<typeof startStub>>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI_BIN = path.resolve(__dirname, '../../cli/dist/bin.js');
const SET_SOURCE = path.resolve(REPO_ROOT, 'jev/support-triage.json');

export const APP_PORT = 4273;
const HEALTH_POLL_ATTEMPTS = 40;
const HEALTH_POLL_INTERVAL_MS = 250;
const RUNNING_AT_RE = /Jev\.UI running at http:\/\/[^/\s]+:(\d+)/;

async function waitForHealth(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/api/health`;
  let lastError: unknown;
  for (let attempt = 0; attempt < HEALTH_POLL_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`GET /api/health responded ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(`Server never became healthy at ${url}: ${String(lastError)}`);
}

interface ServeHandle {
  port: number;
  setsDir: string;
}

function spawnServer(
  setsDir: string,
  stubPort: number,
): ChildProcessByStdio<null, Readable, Readable> {
  // Build the child's env explicitly from a copy of the current one, so the
  // developer's own real TYPESAFE_API_KEY (if set in this shell) never leaks
  // into the stack under test.
  const env = { ...process.env };
  env.TYPESAFE_API_KEY = 'test-key';
  env.TYPESAFE_BASE_URL = `http://127.0.0.1:${stubPort}`;

  return spawn(
    process.execPath,
    [CLI_BIN, 'serve', '--no-open', '--port', String(APP_PORT), '--sets-dir', setsDir],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

async function waitForBoundPort(
  child: ChildProcessByStdio<null, Readable, Readable>,
): Promise<number> {
  let stdout = '';
  let stderr = '';
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const match = RUNNING_AT_RE.exec(stdout);
      if (match?.[1] !== undefined && !settled) {
        settled = true;
        resolve(Number(match[1]));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.once('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`jev serve exited early (code ${code}): ${stderr || stdout}`));
      }
    });
  });
}

async function killChild(child: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill();
  });
}

export const test = base.extend<
  Record<string, never>,
  { stub: Stub; setsDir: string; serveHandle: ServeHandle }
>({
  stub: [
    async ({}, use) => {
      const stub = await startStub();
      await use(stub);
      await stub.close();
    },
    { scope: 'worker' as const },
  ],

  setsDir: [
    async ({}, use) => {
      const dir = await mkdtemp(path.join(tmpdir(), 'jev-e2e-sets-'));
      await cp(SET_SOURCE, path.join(dir, 'support-triage.json'));
      await use(dir);
      await rm(dir, { recursive: true, force: true });
    },
    { scope: 'worker' as const },
  ],

  // `auto: true` so the server (and therefore the stub + temp sets dir it
  // depends on) is always started for every test file in the worker, even
  // one that never names this fixture directly.
  serveHandle: [
    async ({ stub, setsDir }, use) => {
      const child = spawnServer(setsDir, stub.port);
      let boundPort: number;
      try {
        boundPort = await waitForBoundPort(child);
      } catch (err) {
        await killChild(child);
        throw err;
      }

      if (boundPort !== APP_PORT) {
        await killChild(child);
        throw new Error(
          `jev serve bound port ${boundPort}, not the requested ${APP_PORT} ` +
            `(is something else already listening on ${APP_PORT}?).`,
        );
      }

      await waitForHealth(boundPort);

      await use({ port: boundPort, setsDir });

      await killChild(child);
    },
    { scope: 'worker' as const, auto: true },
  ],
});

export { expect };
