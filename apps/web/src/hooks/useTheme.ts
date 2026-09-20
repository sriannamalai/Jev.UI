// The three-way light/dark theme, persisted in `localStorage` (spec §8.1).
// Every storage/matchMedia access is wrapped in try/catch so this works in
// jsdom, private browsing, and any environment where either API is missing
// or throws.
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'jev-ui.theme';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // localStorage unavailable (private browsing, disabled, jsdom quirks) —
    // fall through to the media query.
  }
  try {
    if (matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    // matchMedia unavailable — default to light below.
  }
  return 'light';
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Persistence is best-effort; a full/blocked localStorage must not
      // crash the app.
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return [theme, toggle];
}
