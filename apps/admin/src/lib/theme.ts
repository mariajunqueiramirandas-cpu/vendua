export type ThemePref = 'creme' | 'noite' | 'system';
const KEY = 'vendua-admin-theme';

// the browser chrome colour per theme (`--bg` in theme.css)
const BAR = { creme: [0xf7, 0xf4, 0xea], noite: [0x0a, 0x10, 0x0d] } as const;
// the sheet overlay (Sheet.tsx `bg-[rgb(10_16_13/0.42)]`)
const SCRIM = { rgb: [10, 16, 13], alpha: 0.42 } as const;

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

let dims = 0;

function paintBar() {
  const base = BAR[document.documentElement.dataset.theme === 'noite' ? 'noite' : 'creme'];
  const a = dims ? SCRIM.alpha : 0;
  const hex =
    '#' +
    base
      .map((c, i) =>
        Math.round(c * (1 - a) + SCRIM.rgb[i]! * a)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', hex));
}

/**
 * The status bar dims with an open sheet's overlay, as a native sheet does. Returns the
 * undo; nested sheets stack, and the bar comes back when the last one closes.
 */
export function dimStatusBar() {
  dims++;
  paintBar();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    dims = Math.max(0, dims - 1);
    paintBar();
  };
}

export function applyTheme(pref: ThemePref = readTheme()) {
  const dark = pref === 'noite' || (pref === 'system' && !!media?.matches);
  document.documentElement.dataset.theme = dark ? 'noite' : 'creme';
  paintBar();
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
