// Tracks a CSS media query so layout decisions (like the narrow-viewport
// tab fallback) can be made in JS as well as CSS. `matchMedia`
// can be missing or throw in non-browser/test environments, so every access
// is wrapped in try/catch; the safe default is `false` (the wide layout).
import { useEffect, useState } from 'react';

function readMatches(query: string): boolean {
  try {
    return matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMatches(query));

  useEffect(() => {
    let mql: MediaQueryList;
    try {
      mql = matchMedia(query);
    } catch {
      setMatches(false);
      return;
    }

    setMatches(mql.matches);
    const handleChange = () => setMatches(mql.matches);

    try {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    } catch {
      // Older API surface (Safari <14): addListener/removeListener instead
      // of the EventTarget-style methods above.
      mql.addListener(handleChange);
      return () => mql.removeListener(handleChange);
    }
  }, [query]);

  return matches;
}
