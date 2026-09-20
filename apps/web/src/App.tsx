import { WorkbenchProvider } from './store.js';
import { Workbench } from './components/Workbench.js';

export function App() {
  return (
    <WorkbenchProvider>
      <Workbench />
    </WorkbenchProvider>
  );
}
