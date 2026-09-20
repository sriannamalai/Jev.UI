// Placeholder shell. The real workbench layout (top bar, three-column
// grid, status bar) lands in later tasks; the store is wired in now so
// those tasks can consume `useWorkbench()` directly.
import { WorkbenchProvider } from './store.js';

export function App() {
  return (
    <WorkbenchProvider>
      <header>Jev.UI</header>
      <main />
    </WorkbenchProvider>
  );
}
