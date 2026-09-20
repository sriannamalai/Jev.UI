// The global `⌘/Ctrl+Enter` run shortcut (spec §8.1). Installed by
// `RunButton` with `enabled` mirroring the button's own disabled state, so
// the shortcut and the button always agree on whether a run can start.
import { useEffect } from 'react';

export function useRunShortcut(run: () => unknown, enabled: boolean): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
      if (!enabled) return;
      // Ignore an event another handler (e.g. the JSON pane's own Mod-Enter
      // keymap) already acted on, a held-key repeat, or one still part of an
      // IME composition — any of these would otherwise double-fire `run()`.
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      event.preventDefault();
      run();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [run, enabled]);
}
