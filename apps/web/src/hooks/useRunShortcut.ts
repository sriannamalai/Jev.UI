// The global `⌘/Ctrl+Enter` run shortcut (spec §8.1). Installed by
// `RunButton` with `enabled` mirroring the button's own disabled state, so
// the shortcut and the button always agree on whether a run can start.
import { useEffect } from 'react';

export function useRunShortcut(run: () => unknown, enabled: boolean): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
      if (!enabled) return;
      event.preventDefault();
      run();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [run, enabled]);
}
