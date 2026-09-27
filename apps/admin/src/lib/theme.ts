export type ThemePref = 'creme' | 'noite' | 'system';
const KEY = 'vendua-admin-theme';

export function readTheme(): ThemePref {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'creme' || t === 'noite' ? t : 'system';
  } catch {
    return 'system';
  }
}

const media =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function applyTheme(pref: ThemePref = readTheme()) {
  const dark = pref === 'noite' || (pref === 'system' && !!media?.matches);
  document.documentElement.dataset.theme = dark ? 'noite' : 'creme';
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', dark ? '#0a100d' : '#f7f4ea'));
}

export function setTheme(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* private mode */
  }
  applyTheme(pref);
}

media?.addEventListener('change', () => applyTheme());
