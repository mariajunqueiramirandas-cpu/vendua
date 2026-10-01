// The browser chrome (Android's status bar, Safari's tab tint) wears the store's live `bg`
// token, and dims with the scrim while a sheet is open.

let base: string | null = null;
let ink: string | null = null;
let dimmed = false;

function metas(): HTMLMetaElement[] {
  const list = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  if (list.length) return list;
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  document.head.appendChild(meta);
  return [meta];
}

function rgb(color: string | null): number[] | null {
  const m = color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** `bg` under the sheet's scrim (native.css `--_v-scrim`: the text colour at 42%) */
function dim(bg: string, text: string | null): string {
  const b = rgb(bg);
  if (!b) return bg;
  const t = rgb(text) ?? [0x1c, 0x1b, 0x1a];
  const ch = b.map((c, i) => Math.round(c * 0.58 + t[i]! * 0.42));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function apply() {
  if (!base || typeof document === 'undefined') return;
  const color = dimmed ? dim(base, ink) : base;
  for (const m of metas()) m.content = color;
}

export function setThemeColor(bg: string, text?: string) {
  base = bg;
  ink = text ?? null;
  apply();
}

export function dimThemeColor(on: boolean) {
  dimmed = on;
  apply();
}
