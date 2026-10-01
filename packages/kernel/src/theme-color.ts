// The browser chrome (Android's status bar, Safari's tab tint) wears the store's live `bg`
// token, and dims with the scrim while a sheet is open.

let base: string | null = null;
let dimmed = false;

function metas(): HTMLMetaElement[] {
  const list = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  if (list.length) return list;
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  document.head.appendChild(meta);
  return [meta];
}

/** `#rgb`/`#rrggbb` mixed toward black like the 40% sheet scrim; other syntaxes stay as-is */
function dim(color: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  const ch = [0, 2, 4].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.6));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function apply() {
  if (!base || typeof document === 'undefined') return;
  const color = dimmed ? dim(base) : base;
  for (const m of metas()) m.content = color;
}

export function setThemeColor(bg: string) {
  base = bg;
  apply();
}

export function dimThemeColor(on: boolean) {
  dimmed = on;
  apply();
}
