// The Run button (spec §8, §8.1): disabled while the JSON pane has an
// error, while no API key is configured, or while the request itself is
// invalid — the `title` always explains which. Installs the global
// `⌘/Ctrl+Enter` shortcut whenever it isn't disabled.
import { selectCanRun, useWorkbench } from '../store.js';
import { useRunShortcut } from '../hooks/useRunShortcut.js';

export function RunButton(props: { keyConfigured: boolean | undefined }) {
  const { keyConfigured } = props;
  const { state, run } = useWorkbench();
  const canRun = selectCanRun(state);
  const disabled = !canRun || keyConfigured === false;

  let title: string | undefined;
  if (state.jsonError !== undefined) {
    title = 'Fix the JSON error first';
  } else if (keyConfigured === false) {
    title = 'No API key configured';
  } else if (!canRun) {
    title = 'Add at least one valid question';
  }

  useRunShortcut(run, !disabled);

  return (
    <button
      type="button"
      className="run"
      disabled={disabled}
      aria-busy={state.wb.running}
      title={title}
      onClick={() => void run()}
    >
      {state.wb.running ? 'Running…' : 'Run'} <kbd>⌘↵</kbd>
    </button>
  );
}
