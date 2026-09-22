import { describe, expect, it, vi } from 'vitest';
import { runTui } from '../src/tui/runTui.js';

describe('runTui', () => {
  it('renders the interactive app in the alternate screen', async () => {
    const waitUntilExit = vi.fn(async () => undefined);
    const renderApp = vi.fn((node: unknown, options: unknown) => {
      void node;
      void options;
      return { waitUntilExit };
    });

    await runTui({ stdin: { isTTY: true }, env: {}, renderApp });

    expect(renderApp).toHaveBeenCalledOnce();
    expect(renderApp.mock.calls[0]?.[1]).toMatchObject({
      alternateScreen: true,
      exitOnCtrlC: false,
    });
    expect(waitUntilExit).toHaveBeenCalledOnce();
  });

  it('refuses a non-TTY stdin, prints to stderr, and sets exit code 2 without rendering', async () => {
    const prevExitCode = process.exitCode;
    process.exitCode = undefined;
    const stderr = { write: vi.fn(() => true) };

    await runTui({ stdin: { isTTY: false }, stderr, env: {} });

    expect(stderr.write).toHaveBeenCalledWith(
      'jev: the interactive UI needs a terminal — use "jev ask" for pipes\n',
    );
    expect(process.exitCode).toBe(2);

    process.exitCode = prevExitCode;
  });

  it('also refuses when isTTY is undefined (a pipe)', async () => {
    const prevExitCode = process.exitCode;
    process.exitCode = undefined;
    const stderr = { write: vi.fn(() => true) };

    await runTui({ stdin: {}, stderr, env: {} });

    expect(stderr.write).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(2);

    process.exitCode = prevExitCode;
  });
});
