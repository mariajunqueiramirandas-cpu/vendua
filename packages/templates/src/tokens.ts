// Design tokens as data (04 — design tokens). Core validates edits with this,
// the Kernel build refuses to ship a failing set, and conformance reports it.

export interface FontSource {
  family: string;
  src: string;
  weight?: number | string;
  style?: 'normal' | 'italic';
}

export interface StorefrontTokens {
  color: {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    onAccent: string;
    danger: string;
    success: string;
  };
  font: { display: string; body: string; mono?: string; srcs?: FontSource[] };
  radius: { sm: string; md: string; lg: string };
  space: { scale: number | string[] };
  motion: { duration: string; easing: string };
}

const COLOR_KEYS = ['bg', 'surface', 'text', 'muted', 'accent', 'onAccent', 'danger', 'success'];
const MAX_VALUE = 200;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= MAX_VALUE;
// values land in CSS custom properties — no way to break out of the declaration
const cssSafe = (v: string) => !/[;{}<>]|\/\*|url\s*\(\s*['"]?\s*javascript:/i.test(v);

export function validateTokens(
  input: unknown,
): { ok: true; tokens: StorefrontTokens } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['tokens must be an object'] };
  const need = (group: string, keys: string[], optional: string[] = []) => {
    const g = input[group];
    if (!isObj(g)) {
      errors.push(`${group} must be an object`);
      return;
    }
    for (const k of keys) {
      if (!str(g[k])) errors.push(`${group}.${k} must be a non-empty string ≤ ${MAX_VALUE} chars`);
      else if (!cssSafe(g[k] as string)) errors.push(`${group}.${k} contains unsafe characters`);
    }
    for (const k of optional)
      if (g[k] !== undefined && (!str(g[k]) || !cssSafe(g[k] as string)))
        errors.push(`${group}.${k} must be a safe string when present`);
  };
  need('color', COLOR_KEYS);
  need('font', ['display', 'body'], ['mono']);
  need('radius', ['sm', 'md', 'lg']);
  need('motion', ['duration', 'easing']);
  if (!isObj(input.space)) errors.push('space must be an object');
  else {
    const s = input.space.scale;
    const okScale =
      (typeof s === 'number' && s > 0 && s < 10) ||
      (Array.isArray(s) && s.length > 0 && s.length <= 16 && s.every((x) => str(x) && cssSafe(x)));
    if (!okScale) errors.push('space.scale must be a number (0–10) or ≤16 CSS lengths');
  }
  const font = input.font;
  if (isObj(font) && font.srcs !== undefined) {
    if (!Array.isArray(font.srcs) || font.srcs.length > 12) errors.push('font.srcs: ≤ 12 entries');
    else
      font.srcs.forEach((f, i) => {
        if (!isObj(f) || !str(f.family) || !str(f.src))
          errors.push(`font.srcs[${i}] needs family + src`);
        else if (!/^(\/|https:\/\/)/.test(f.src as string))
          errors.push(`font.srcs[${i}].src must be a path or https URL`);
      });
  }
  if (errors.length) return { ok: false, errors };
  const contrast = contrastProblems(input as unknown as StorefrontTokens);
  if (contrast.length) return { ok: false, errors: contrast };
  return { ok: true, tokens: input as unknown as StorefrontTokens };
}

// ── WCAG 2.x contrast ────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  transparent: '#00000000',
};

/** Parses the colour syntaxes tokens use (hex, rgb[a], hsl[a], a few names) to 0–255 RGB. */
export function parseColor(input: string): [number, number, number] | null {
  const v = (NAMED[input.trim().toLowerCase()] ?? input).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v);
  if (m)
    return [Number(m[1]), Number(m[2]), Number(m[3])].map((x) => Math.min(255, x)) as [
      number,
      number,
      number,
    ];
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(v);
  if (m) {
    const h = Number(m[1]) / 360;
    const s = Number(m[2]) / 100;
    const l = Number(m[3]) / 100;
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  }
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = [r, g, b].map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrastRatio(fg: string, bg: string): number | null {
  const a = parseColor(fg);
  const b = parseColor(bg);
  if (!a || !b) return null;
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Token pairs the Kernel's default surfaces actually render text with. */
export const CONTRAST_PAIRS: readonly [
  keyof StorefrontTokens['color'],
  keyof StorefrontTokens['color'],
][] = [
  ['text', 'bg'],
  ['muted', 'bg'],
  ['text', 'surface'],
  ['muted', 'surface'],
  ['onAccent', 'accent'],
  ['danger', 'bg'],
  ['danger', 'surface'],
];

/** WCAG AA (4.5:1) on every default-surface pair — a failure blocks release. */
export function contrastProblems(tokens: StorefrontTokens, min = 4.5): string[] {
  const out: string[] = [];
  for (const [fg, bg] of CONTRAST_PAIRS) {
    const r = contrastRatio(tokens.color[fg], tokens.color[bg]);
    if (r === null)
      out.push(
        `color.${fg} / color.${bg}: cannot parse (${tokens.color[fg]} on ${tokens.color[bg]})`,
      );
    else if (r < min)
      out.push(
        `color.${fg} on color.${bg}: ${r.toFixed(2)}:1 < ${min}:1 (${tokens.color[fg]} on ${tokens.color[bg]})`,
      );
  }
  return out;
}
