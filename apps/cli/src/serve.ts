import { fileURLToPath } from 'node:url';
import { resolveApiKey } from '@jev-ui/core';
import { startServer as defaultStartServer } from '@jev-ui/server';
import type { RunningServer, StartOptions } from '@jev-ui/server';
import defaultOpen from 'open';

export interface ServeOptions {
  port?: number;
  open?: boolean;
  setsDir?: string;
}

/** Minimal signal-emitting surface `runServe` listens on; `process` satisfies it. */
export interface SignalSource {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export interface ServeIo {
  startServer?: (opts: StartOptions) => Promise<RunningServer>;
  open?: (url: string) => Promise<unknown>;
  stdout?: { write(s: string): unknown };
  stderr?: { write(s: string): unknown };
  env?: NodeJS.ProcessEnv;
  signals?: SignalSource;
}

/** Start the local server and open a browser to it; resolves once shut down via SIGINT/SIGTERM. */
export async function runServe(opts: ServeOptions = {}, io: ServeIo = {}): Promise<void> {
  const startServerFn = io.startServer ?? defaultStartServer;
  const openFn = io.open ?? defaultOpen;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const signals = io.signals ?? process;

  const webDir = fileURLToPath(new URL('./web', import.meta.url));

  const server = await startServerFn({
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    ...(opts.setsDir !== undefined ? { setsDir: opts.setsDir } : {}),
    webDir,
    env,
  });

  stdout.write(`Jev.UI running at ${server.url}\n`);

  if (resolveApiKey(undefined, env) === undefined) {
    stderr.write('Warning: TYPESAFE_API_KEY is not set; requests to the model will fail.\n');
  }

  if (opts.open !== false) {
    try {
      await openFn(server.url);
    } catch {
      stderr.write(`Could not open a browser automatically; visit ${server.url} manually.\n`);
    }
  }

  let closed = false;
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      if (closed) return;
      closed = true;
      signals.off('SIGINT', shutdown);
      signals.off('SIGTERM', shutdown);
      server.close().finally(resolve);
    };
    signals.on('SIGINT', shutdown);
    signals.on('SIGTERM', shutdown);
  });
}
