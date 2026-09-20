// The application shell (spec §8, §8.1): top bar, the Build/JSON/Results
// three-column layout (unmounting whichever pane the current mode doesn't
// need, rather than hiding it — the JSON pane's CodeMirror instance must
// not run while it's off-screen), and the status bar. `health.keyConfigured`
// is read from the single `useServerInfo` fetch owned here and threaded down
// to both `TopBar` and `SetupScreen` so the shell never fetches
// `/api/health` twice. `api` defaults to the real client but can be injected
// (tests share the same fake given to `WorkbenchProvider`).
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api as defaultApi, type createApi } from '../api.js';
import { useWorkbench } from '../store.js';
import { useServerInfo } from '../hooks/useServerInfo.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { TopBar } from './TopBar.js';
import { SetupScreen } from './SetupScreen.js';
import { Banner } from './Banner.js';
import { StatePane } from './StatePane.js';
import { QuestionList } from './QuestionList.js';
import { JsonPane } from './JsonPane.js';
import { ResultsPane } from './ResultsPane.js';
import { StatusBar } from './StatusBar.js';

type Api = ReturnType<typeof createApi>;
type BuildTab = 'build' | 'json';

const NARROW_QUERY = '(max-width: 899px)';

function BuildSection() {
  return (
    <section className="col col-form" aria-label="Build">
      <div className="col-head">Build</div>
      <div className="pad">
        <StatePane />
        <QuestionList />
      </div>
    </section>
  );
}

function BuildJsonTabs() {
  const [tab, setTab] = useState<BuildTab>('build');
  const buildTabRef = useRef<HTMLButtonElement | null>(null);
  const jsonTabRef = useRef<HTMLButtonElement | null>(null);

  function select(next: BuildTab): void {
    setTab(next);
    (next === 'build' ? buildTabRef : jsonTabRef).current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    select(tab === 'build' ? 'json' : 'build');
  }

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Build or JSON" onKeyDown={handleKeyDown}>
        <button
          ref={buildTabRef}
          type="button"
          role="tab"
          id="tab-build"
          aria-selected={tab === 'build'}
          aria-controls="tabpanel-build-json"
          tabIndex={tab === 'build' ? 0 : -1}
          onClick={() => select('build')}
        >
          Build
        </button>
        <button
          ref={jsonTabRef}
          type="button"
          role="tab"
          id="tab-json"
          aria-selected={tab === 'json'}
          aria-controls="tabpanel-build-json"
          tabIndex={tab === 'json' ? 0 : -1}
          onClick={() => select('json')}
        >
          JSON
        </button>
      </div>
      <div
        id="tabpanel-build-json"
        role="tabpanel"
        aria-labelledby={tab === 'build' ? 'tab-build' : 'tab-json'}
      >
        {tab === 'build' ? <BuildSection /> : <JsonPane />}
      </div>
    </>
  );
}

export function Workbench(props: { api?: Api }) {
  const api = props.api ?? defaultApi;
  const { state } = useWorkbench();
  const serverInfo = useServerInfo(api);
  const narrow = useMediaQuery(NARROW_QUERY);

  const mode = state.mode;
  const tabbed = narrow && mode === 'split';

  let columns: ReactNode;
  if (tabbed) {
    columns = <BuildJsonTabs />;
  } else {
    columns = (
      <>
        {mode !== 'json' && <BuildSection />}
        {mode !== 'form' && <JsonPane />}
      </>
    );
  }

  return (
    <>
      <TopBar serverInfo={serverInfo} />
      <SetupScreen keyConfigured={serverInfo.health?.keyConfigured} />
      <Banner />
      <main data-mode={mode}>
        {columns}
        <ResultsPane />
      </main>
      <StatusBar />
    </>
  );
}
