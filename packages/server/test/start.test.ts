import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../src/start.js';

type Started = Awaited<ReturnType<typeof startServer>>;

const started: Started[] = [];
const sockets: net.Server[] = [];

function occupy(port = 0): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    sockets.push(server);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no port'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

/** `fetch` forbids overriding `Host`, so the guard is probed with a raw HTTP request. */
function statusWithHost(port: number, host: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/api/health', headers: { host } },
      (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode));
      },
    );
    req.once('error', reject);
    req.end();
  });
}

function release(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function start(opts: Parameters<typeof startServer>[0]): Promise<Started> {
  const handle = await startServer(opts);
  started.push(handle);
  return handle;
}

afterEach(async () => {
  while (started.length > 0) await started.pop()?.close();
  while (sockets.length > 0) {
    const server = sockets.pop();
    if (server) await release(server);
  }
});

describe('startServer', () => {
  it('binds the requested port and serves health on 127.0.0.1', async () => {
    const { port: free } = await occupy();
    await release(sockets[sockets.length - 1] as net.Server);
    sockets.pop();

    const server = await start({ port: free, env: {}, setsDir: '/tmp/jev-sets-a' });
    expect(server.port).toBe(free);
    expect(server.url).toBe(`http://127.0.0.1:${free}`);

    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      keyConfigured: false,
      version: expect.any(String) as unknown as string,
      setsDir: path.resolve('/tmp/jev-sets-a'),
    });
  });

  it('moves to the next free port when the requested one is taken', async () => {
    const { port: busy } = await occupy();
    const server = await start({ port: busy, env: {} });
    expect(server.port).toBeGreaterThan(busy);
    expect(server.port).toBeLessThanOrEqual(busy + 20);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);

    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);
  });

  it('guards with the port it actually bound, not the one asked for', async () => {
    const { port: busy } = await occupy();
    const server = await start({ port: busy, env: {} });
    // `Host` names the busy (requested) port, so it no longer matches the bound one.
    expect(await statusWithHost(server.port, `127.0.0.1:${busy}`)).toBe(403);
    expect(await statusWithHost(server.port, `127.0.0.1:${server.port}`)).toBe(200);
  });

  it('reports the key as configured without ever returning it', async () => {
    const { port: free } = await occupy();
    await release(sockets[sockets.length - 1] as net.Server);
    sockets.pop();

    const server = await start({ port: free, env: { TYPESAFE_API_KEY: 'ts-fake-key-zzz999' } });
    const res = await fetch(`${server.url}/api/health`);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ keyConfigured: true });
    expect(text).not.toContain('ts-fake-key-zzz999');
  });

  it('survives a post-listen error event and still closes cleanly', async () => {
    const { port: free } = await occupy();
    await release(sockets[sockets.length - 1] as net.Server);
    sockets.pop();

    const logged: string[] = [];
    const server = await start({ port: free, env: {}, onError: (line) => logged.push(line) });

    expect(() => server.server.emit('error', new Error('socket exploded'))).not.toThrow();
    expect(logged).toEqual(['Jev UI server error: socket exploded']);

    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);
    await started.pop()?.close();
  });

  it('frees the port on close', async () => {
    const { port: free } = await occupy();
    await release(sockets[sockets.length - 1] as net.Server);
    sockets.pop();

    const server = await start({ port: free, env: {} });
    await started.pop()?.close();

    const reused = await occupy(free);
    expect(reused.port).toBe(free);
    expect(server.port).toBe(free);
  });
});
