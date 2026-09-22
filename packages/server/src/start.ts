import { promises as fs } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import {
  createHistory,
  createSets,
  defaultHistoryFile,
  listModels,
  resolveApiKey,
  resolveSetsDir,
  run,
} from '@jev-ui/core';
import { createApp } from './app.js';
import { SERVER_VERSION } from './version.js';

export interface StartOptions {
  port?: number;
  setsDir?: string;
  webDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Where a post-listen server error is reported. Defaults to a single line on stderr. */
  onError?: (message: string) => void;
}

export interface RunningServer {
  port: number;
  url: string;
  /** The listening HTTP server, for callers that need the raw handle. */
  server: ServerType;
  close(): Promise<void>;
}

export const DEFAULT_PORT = 4173;
const MAX_PORT_ATTEMPTS = 20;
const HOSTNAME = '127.0.0.1';

export { SERVER_VERSION } from './version.js';

/** Start the localhost server, bumping the port while the requested one is taken. */
export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const env = opts.env ?? process.env;
  const setsDir = resolveSetsDir(opts.setsDir, env);
  const webDir = await existingDir(opts.webDir);

  let boundPort = opts.port ?? DEFAULT_PORT;
  const app = createApp({
    run,
    listModels,
    sets: createSets(setsDir),
    history: createHistory(defaultHistoryFile(env)),
    keyConfigured: () => resolveApiKey(undefined, env) !== undefined,
    version: SERVER_VERSION,
    getPort: () => boundPort,
    ...(webDir === undefined ? {} : { webDir }),
  });

  const first = opts.port ?? DEFAULT_PORT;
  const last = first + MAX_PORT_ATTEMPTS;
  let server: ServerType | undefined;
  for (let port = first; port <= last; port++) {
    server = await listen(app.fetch, port);
    if (server !== undefined) {
      boundPort = actualPort(server, port);
      break;
    }
  }

  if (server === undefined) {
    throw new Error(`No free port for the Jev UI server between ${first} and ${last}.`);
  }

  const listener = server;

  // The startup listener is removed once the port is bound, and a Node server with no `'error'`
  // listener rethrows the event as an uncaught exception that would take the process down. Report
  // a later error (a socket-level failure, say) on one line instead and keep serving.
  const onError = opts.onError ?? ((message: string) => process.stderr.write(`${message}\n`));
  listener.on('error', (err: Error) => {
    onError(`Jev UI server error: ${err.message}`);
  });

  return {
    port: boundPort,
    url: `http://${HOSTNAME}:${boundPort}`,
    server: listener,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // Keep-alive sockets would otherwise hold the listener open indefinitely.
        const closeIdle = (listener as { closeIdleConnections?: () => void }).closeIdleConnections;
        closeIdle?.call(listener);
        listener.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Resolves to the listening server, or `undefined` when the port is already taken. */
function listen(
  fetch: Parameters<typeof serve>[0]['fetch'],
  port: number,
): Promise<ServerType | undefined> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, hostname: HOSTNAME, port }, () => {
      server.removeListener('error', onError);
      resolve(server);
    });
    server.once('error', onError);

    function onError(err: NodeJS.ErrnoException): void {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(undefined);
        return;
      }
      reject(err);
    }
  });
}

function actualPort(server: ServerType, fallback: number): number {
  const address = server.address();
  return address !== null && typeof address !== 'string' ? (address as AddressInfo).port : fallback;
}

/** A web directory that is not on disk yet is treated as absent (the CLI passes one eagerly). */
async function existingDir(dir: string | undefined): Promise<string | undefined> {
  if (dir === undefined) return undefined;
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory() ? dir : undefined;
  } catch {
    return undefined;
  }
}
