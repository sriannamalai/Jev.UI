// The application's top bar (spec §8): set/model pickers, the Form/Split/
// JSON mode toggle, Save, Export code, the theme toggle, the API-key
// indicator, and Run. `api` defaults to the real client but can be injected
// (tests inject the same fake given to `WorkbenchProvider`).
import { useState } from 'react';
import { DEFAULT_MODEL } from '@jev-ui/core/browser';
import { api as defaultApi, type createApi } from '../api.js';
import { useWorkbench } from '../store.js';
import { useServerInfo } from '../hooks/useServerInfo.js';
import { SetPicker } from './SetPicker.js';
import { ModelPicker } from './ModelPicker.js';
import { ModeToggle } from './ModeToggle.js';
import { SaveButton } from './SaveButton.js';
import { ExportMenu } from './ExportMenu.js';
import { ThemeToggle } from './ThemeToggle.js';
import { RunButton } from './RunButton.js';

type Api = ReturnType<typeof createApi>;

export function TopBar(props: { api?: Api }) {
  const api = props.api ?? defaultApi;
  const { state, dispatch, load } = useWorkbench();
  const { health, models, sets, refreshSets } = useServerInfo(api);
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
