export type Theme = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'carwash-theme';

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
  localStorage.setItem(STORAGE_KEY, theme);
}

export function cycleTheme(current: Theme): Theme {
  if (current === 'dark') return 'light';
  if (current === 'light') return 'system';
  return 'dark';
}
