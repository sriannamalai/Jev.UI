import type { MiddlewareHandler } from 'hono';

function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  return lower === `127.0.0.1:${port}` || lower === `localhost:${port}`;
}

function isAllowedOrigin(origin: string, port: number): boolean {
  const lower = origin.toLowerCase();
  return lower === `http://127.0.0.1:${port}` || lower === `http://localhost:${port}`;
}

function forbidden(message: 'forbidden host' | 'forbidden origin'): Response {
  return new Response(JSON.stringify({ error: { kind: 'unexpected', message } }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Rejects any request whose Host header is not exactly 127.0.0.1:<port> or
 * localhost:<port>, and any request carrying an Origin header that doesn't
 * match one of those two origins. Never sets any Access-Control-* header.
 */
export function hostGuard(getPort: () => number): MiddlewareHandler {
  return async (c, next) => {
    const port = getPort();
    const host = c.req.header('host');
    if (!isAllowedHost(host, port)) {
      return forbidden('forbidden host');
    }

    const origin = c.req.header('origin');
    if (origin !== undefined && !isAllowedOrigin(origin, port)) {
      return forbidden('forbidden origin');
    }

    await next();
  };
}
