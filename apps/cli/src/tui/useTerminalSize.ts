// Terminal-size hook shared by the TUI shell. Ink's own `useStdout` exposes
// the live stream; this wraps it with the 100x30 fallback tests/CI (no real
// TTY) need and an `override` that wins over the stream entirely — used by
// `App`'s `deps.columns` and directly by tests.
import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export interface TerminalSize {
  columns: number;
  rows: number;
}

export interface TerminalSizeOverride {
  columns?: number;
  rows?: number;
}

const DEFAULT_COLUMNS = 100;
const DEFAULT_ROWS = 30;

export function useTerminalSize(override?: TerminalSizeOverride): TerminalSize {
  const { stdout } = useStdout();
  // Only used to force a re-render when the real terminal resizes; the size
  // itself is always recomputed from the live stream (and `override`) below.
  const [, bump] = useState(0);

  useEffect(() => {
    const onResize = (): void => bump((n) => n + 1);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return {
    columns: override?.columns ?? stdout.columns ?? DEFAULT_COLUMNS,
    rows: override?.rows ?? (stdout as { rows?: number }).rows ?? DEFAULT_ROWS,
  };
}
