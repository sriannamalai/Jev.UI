import type { RunningServer } from '@jev-ui/server';
import { describe, expect, it, vi } from 'vitest';
import { runServe, type SignalSource } from '../src/serve.js';

function makeWriter() {
  const chunks: string[] = [];
  return {
    write(s: string): boolean {
      chunks.push(s);
      return true;
    },
    get output(): string {
      return chunks.join('');
    },
  };
}

function makeSignals(): SignalSource & { emit(event: 'SIGINT' | 'SIGTERM'): void } {
  const listeners: Record<string, Array<() => void>> = { SIGINT: [], SIGTERM: [] };
  return {
    on(event, listener) {
      listeners[event]?.push(listener);
      return this;
    },
    off(event, listener) {
      const arr = listeners[event];
      if (arr) {
        const idx = arr.indexOf(listener);
        if (idx >= 0) arr.splice(idx, 1);
      }
      return this;
    },
    emit(event) {
      for (const listener of [...(listeners[event] ?? [])]) listener();
    },
  };
}

function makeServer(close: () => Promise<void>): RunningServer {
  return { port: 4173, url: 'http://127.0.0.1:4173', close };
}

describe('runServe', () => {
  it('prints the URL line exactly once', async () => {
    const stdout = makeWriter();
    const stderr = makeWriter();
    const signals = makeSignals();
    const close = vi.fn(async () => undefined);
    const startServer = vi.fn(async () => makeServer(close));
    const open = vi.fn(async () => undefined);

    const p = runServe(
      { open: false },
      { startServer, open, stdout, stderr, env: { TYPESAFE_API_KEY: 'k' }, signals },
    );
    await vi.waitFor(() => expect(stdout.output).toContain('Jev.UI running at'));
    expect(stdout.output).toBe('Jev.UI running at http://127.0.0.1:4173\n');

    signals.emit('SIGINT');
    await p;
  });

  it('warns on stderr when no API key is configured', async () => {
    const stdout = makeWriter();
    const stderr = makeWriter();
    const signals = makeSignals();
    const close = vi.fn(async () => undefined);
    const startServer = vi.fn(async () => makeServer(close));
    const open = vi.fn(async () => undefined);

    const p = runServe({ open: false }, { startServer, open, stdout, stderr, env: {}, signals });
    await vi.waitFor(() => expect(stderr.output).toContain('TYPESAFE_API_KEY'));

    signals.emit('SIGINT');
    await p;
  });

  it('does not call open when open:false', async () => {
    const stdout = makeWriter();
    const stderr = makeWriter();
    const signals = makeSignals();
    const close = vi.fn(async () => undefined);
    const startServer = vi.fn(async () => makeServer(close));
    const open = vi.fn(async () => undefined);

    const p = runServe(
      { open: false },
      { startServer, open, stdout, stderr, env: { TYPESAFE_API_KEY: 'k' }, signals },
    );
    await vi.waitFor(() => expect(stdout.output.length).toBeGreaterThan(0));
    expect(open).not.toHaveBeenCalled();

    signals.emit('SIGINT');
    await p;
  });

  it('swallows a browser-open rejection without crashing', async () => {
    const stdout = makeWriter();
    const stderr = makeWriter();
    const signals = makeSignals();
    const close = vi.fn(async () => undefined);
    const startServer = vi.fn(async () => makeServer(close));
    const open = vi.fn(async () => {
      throw new Error('no display');
    });

    const p = runServe(
      {},
      { startServer, open, stdout, stderr, env: { TYPESAFE_API_KEY: 'k' }, signals },
    );
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    await vi.waitFor(() => expect(stderr.output).toContain('http://127.0.0.1:4173'));

    signals.emit('SIGINT');
    await p;
  });

  it('closes the server exactly once even if signalled twice', async () => {
    const stdout = makeWriter();
    const stderr = makeWriter();
    const signals = makeSignals();
    const close = vi.fn(async () => undefined);
    const startServer = vi.fn(async () => makeServer(close));
    const open = vi.fn(async () => undefined);

    const p = runServe(
      { open: false },
      { startServer, open, stdout, stderr, env: { TYPESAFE_API_KEY: 'k' }, signals },
    );
    await vi.waitFor(() => expect(stdout.output.length).toBeGreaterThan(0));

    signals.emit('SIGINT');
    signals.emit('SIGINT');
    await p;

    expect(close).toHaveBeenCalledTimes(1);
  });
});
