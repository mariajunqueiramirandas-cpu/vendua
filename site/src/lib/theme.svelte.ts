// The visitor's explicit theme choice, if any (otherwise the system decides). app.html applies a
// stored choice before first paint; ThemeToggle changes it; Screen follows it for the screenshots.
export type Theme = 'light' | 'dark';

export const KEY = 'vendua-theme';
export const theme = $state<{ chosen: Theme | null }>({ chosen: null });

// the browser chrome colour for each theme (app.html's two theme-color metas)
export const BAR: Record<Theme, string> = { light: '#fff6ea', dark: '#1d1a14' };

const system = (): Theme => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export const current = (): Theme => theme.chosen ?? system();

export function choose(next: Theme) {
  // picking what the system already says means "follow the system" again
  const chosen = next === system() ? null : next;
  theme.chosen = chosen;
  const root = document.documentElement;
  if (chosen) root.dataset.theme = chosen;
  else delete root.dataset.theme;
  try {
    if (chosen) localStorage.setItem(KEY, chosen);
    else localStorage.removeItem(KEY);
  } catch {
    // private mode: the choice lasts until the page closes
  }
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
    meta.content = BAR[chosen ?? (meta.media.includes('dark') ? 'dark' : 'light')];
}
