import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { hostGuard } from '../src/guard.js';

function makeApp(getPort: () => number): Hono {
  const app = new Hono();
  app.use('*', hostGuard(getPort));
  app.get('/x', (c) => c.text('ok'));
  return app;
}

describe('hostGuard', () => {
  it('allows the correct host', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', { headers: { host: '127.0.0.1:4173' } });
    expect(res.status).toBe(200);
  });

  it('rejects an unrelated host', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', { headers: { host: 'evil.com' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { kind: 'unexpected', message: 'forbidden host' } });
  });

  it('rejects the right hostname with the wrong port', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', { headers: { host: '127.0.0.1:9999' } });
    expect(res.status).toBe(403);
  });

  it('rejects a missing host header', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', { headers: {} });
    expect(res.status).toBe(403);
  });

  it('allows localhost case-insensitively', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', { headers: { host: 'LOCALHOST:4173' } });
    expect(res.status).toBe(200);
  });

  it('rejects a trailing dot on the hostname', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', { headers: { host: 'localhost.:4173' } });
    expect(res.status).toBe(403);
  });

  it('rejects the IPv6 loopback form', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', { headers: { host: '[::1]:4173' } });
    expect(res.status).toBe(403);
  });

  it('rejects a cross-site origin with a correct host', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', {
      headers: { host: '127.0.0.1:4173', origin: 'https://evil.com' },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { kind: 'unexpected', message: 'forbidden origin' },
    });
  });

  it('allows a matching localhost origin', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', {
      headers: { host: '127.0.0.1:4173', origin: 'http://localhost:4173' },
    });
    expect(res.status).toBe(200);
  });

  it('allows a matching 127.0.0.1 origin', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', {
      headers: { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects an origin of null', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', {
      headers: { host: '127.0.0.1:4173', origin: 'null' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects an origin with the wrong port', async () => {
    const app = makeApp(() => 4173);
    const res = await app.request('/x', {
      headers: { host: '127.0.0.1:4173', origin: 'http://localhost:9999' },
    });
    expect(res.status).toBe(403);
  });

  it('re-reads the port on every request', async () => {
    let port = 4173;
    const app = makeApp(() => port);

    const first = await app.request('/x', { headers: { host: '127.0.0.1:4173' } });
    expect(first.status).toBe(200);

    port = 5000;
    const second = await app.request('/x', { headers: { host: '127.0.0.1:4173' } });
    expect(second.status).toBe(403);

    const third = await app.request('/x', { headers: { host: '127.0.0.1:5000' } });
    expect(third.status).toBe(200);
  });

  it('never sets an access-control header, allowed or denied', async () => {
    const app = makeApp(() => 4173);

    const allowed = await app.request('/x', { headers: { host: '127.0.0.1:4173' } });
    const denied = await app.request('/x', { headers: { host: 'evil.com' } });

    for (const res of [allowed, denied]) {
      for (const key of res.headers.keys()) {
        expect(key.toLowerCase().startsWith('access-control-')).toBe(false);
      }
    }
  });
});
