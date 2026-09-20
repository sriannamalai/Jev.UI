// The light/dark theme toggle (spec §8.1). All the persistence/detection
// logic lives in `useTheme`; this is purely a labelled button over it.
import { useTheme } from '../hooks/useTheme.js';

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button type="button" className="ghost" aria-label={label} onClick={toggle}>
      {theme === 'dark' ? '☀' : '◐'}
    </button>
  );
}
