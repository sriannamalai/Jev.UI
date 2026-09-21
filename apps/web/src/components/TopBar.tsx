// The application's top bar: set/model pickers, the Form/Split/
// JSON mode toggle, Save, Export code, the theme toggle, the API-key
// indicator, and Run. Every action that needs the API (running, saving,
// loading a set) goes through `useWorkbench()`, which is already bound to
// whatever `api` the enclosing `WorkbenchProvider` was given. `serverInfo` is
// owned by the caller (the shell fetches `/api/health` etc. exactly once and
// hands the result down) rather than fetched here, so mounting `TopBar`
// never triggers its own, second round of requests.
import { useState } from 'react';
import { DEFAULT_MODEL } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';
import type { ServerInfo } from '../hooks/useServerInfo.js';
import { SetPicker } from './SetPicker.js';
import { ModelPicker } from './ModelPicker.js';
import { ModeToggle } from './ModeToggle.js';
import { SaveButton } from './SaveButton.js';
import { ExportMenu } from './ExportMenu.js';
import { ThemeToggle } from './ThemeToggle.js';
import { RunButton } from './RunButton.js';

export function TopBar(props: { serverInfo: ServerInfo }) {
  const { state, dispatch, load } = useWorkbench();
  const { health, models, sets, refreshSets } = props.serverInfo;
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  async function handleLoad(name: string) {
    setLoadError(undefined);
    try {
      await load(name);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  const keyLabel =
    health === undefined
      ? 'Checking API key…'
      : health.keyConfigured
        ? 'API key detected'
        : 'No API key';
  const keyClass = health?.keyConfigured === false ? 'dot warn' : 'dot';

  return (
    <header className="bar" role="banner">
      <div className="logo">
        <i /> Jev.UI
      </div>
      <SetPicker
        sets={sets}
        current={state.wb.setName}
        dirty={state.wb.dirty}
        onLoad={(name) => void handleLoad(name)}
      />
      <ModelPicker
        models={models}
        value={state.wb.request.model ?? DEFAULT_MODEL}
        resolved={state.wb.result?.model}
        onChange={(model) => dispatch({ type: 'wb', action: { type: 'setModel', model } })}
      />
      {loadError !== undefined && <span role="alert">{loadError}</span>}
      <div className="grow" />
      <ModeToggle mode={state.mode} onChange={(mode) => dispatch({ type: 'setMode', mode })} />
      <SaveButton onSaved={refreshSets} />
      <ExportMenu />
      <ThemeToggle />
      <span role="img" aria-label={keyLabel} className={keyClass} />
      <RunButton keyConfigured={health?.keyConfigured} />
    </header>
  );
}
