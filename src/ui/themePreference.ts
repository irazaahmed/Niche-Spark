// Light/dark theme chosen in the extension. Kept in localStorage (shared by the
// popup and dashboard, readable before the first paint); no choice = follow the system.
export type Theme = 'light' | 'dark';

const KEY = 'nichespark.theme';

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** The theme currently shown. */
export function currentTheme(): Theme {
  return saved() ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

/** Applies the saved choice to <html>; call before rendering. Keeps open pages in step. */
export function applySavedTheme() {
  const set = () => {
    const theme = saved();
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  };
  set();
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) set();
  });
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable: still switch for this page */
  }
  document.documentElement.dataset.theme = theme;
}
