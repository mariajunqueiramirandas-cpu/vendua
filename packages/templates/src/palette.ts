// One accent → the full colour set. The admin's appearance screen and Core's menu import
// both derive tokens here, so an imported brand colour looks the way picking it would.
// A set is two choices a merchant makes apart: the main colour (accent) and the tone of
// the page around it (TONES), so changing one never undoes the other.

import { contrastRatio, parseColor, type StorefrontTokens } from './tokens.ts';

/** The text colour that reads best on a fill. */
export function onColor(fill: string): string {
  const w = contrastRatio('#ffffff', fill) ?? 0;
  const k = contrastRatio('#141414', fill) ?? 0;
  return w >= k ? '#FFFFFF' : '#141414';
}

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();
}

/** Any colour tokens accept, as #RRGGBB; null when it doesn't parse. */
export function normalizeHex(input: string): string | null {
  const rgb = parseColor(input);
  return rgb ? toHex(...rgb) : null;
}

/** Darken until it carries text at AA. */
export function readableAccent(c: string): string {
  let [r, g, b] = parseColor(c) ?? [0, 0, 0];
  for (
    let i = 0;
    i < 20 && (contrastRatio(onColor(toHex(r, g, b)), toHex(r, g, b)) ?? 0) < 4.5;
    i++
  ) {
    r *= 0.9;
    g *= 0.9;
    b *= 0.9;
  }
  return toHex(r, g, b);
}

export function paletteFrom<T extends Pick<StorefrontTokens, 'color'>>(
  accentIn: string,
  base: T,
  dark = false,
): T {
  const accent = readableAccent(accentIn);
  return {
    ...base,
    color: { ...TONES[dark ? 'escuro' : 'claro'], accent, onAccent: onColor(accent) },
  };
}

type Color = StorefrontTokens['color'];
type Neutrals = Omit<Color, 'accent' | 'onAccent'>;
export type Tone = 'claro' | 'creme' | 'escuro';

/** The page around the main colour: every one reads at AA with any accent `readableAccent`
 *  gives, and with its own danger and success. */
export const TONES: Record<Tone, Neutrals> = {
  claro: {
    bg: '#FCFBF8',
    surface: '#FFFFFF',
    text: '#1A1714',
    muted: '#6B6456',
    danger: '#B3372F',
    success: '#3D7A4F',
  },
  creme: {
    bg: '#F5EEE1',
    surface: '#FFFBF4',
    text: '#2A2119',
    muted: '#675948',
    danger: '#A6302A',
    success: '#3A6F48',
  },
  escuro: {
    bg: '#14110F',
    surface: '#1E1A17',
    text: '#F5F1EA',
    muted: '#BDB3A5',
    danger: '#FF8A7F',
    success: '#6FD39C',
  },
};

const NEUTRAL_KEYS = ['bg', 'surface', 'text', 'muted', 'danger', 'success'] as const;

/** Which tone a set's page colours are, or null for the store's own. */
export function toneOf(color: Color): Tone | null {
  const same = (a: string, b: string) => normalizeHex(a) === normalizeHex(b);
  return (
    (Object.keys(TONES) as Tone[]).find((t) =>
      NEUTRAL_KEYS.every((k) => same(color[k], TONES[t][k])),
    ) ?? null
  );
}

/** The page colours of a tone (or another set's), keeping the main colour. */
export function withNeutrals(color: Color, neutrals: Neutrals): Color {
  const out = { ...color };
  for (const k of NEUTRAL_KEYS) out[k] = neutrals[k];
  return out;
}

/** A main colour as it is, with the text colour that reads best on it. */
export function withAccent(color: Color, accent: string): Color {
  const a = normalizeHex(accent) ?? color.accent;
  return { ...color, accent: a, onAccent: onColor(a) };
}

const MIN = 4.5;
const mix = (a: [number, number, number], b: [number, number, number], t: number) =>
  toHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

/** Moved toward black or white (whichever reads better on both) by the least it takes to
 *  read at AA on each of them; unchanged when it already does. */
function readableOn(fg: string, bgs: string[]): string {
  const worst = (c: string) => Math.min(...bgs.map((b) => contrastRatio(c, b) ?? 0));
  if (worst(fg) >= MIN) return fg;
  const from = parseColor(fg) ?? [128, 128, 128];
  const to: [number, number, number] =
    worst('#000000') >= worst('#FFFFFF') ? [0, 0, 0] : [255, 255, 255];
  for (let i = 1; i <= 20; i++) {
    const c = mix(from, to, i / 20);
    if (worst(c) >= MIN) return c;
  }
  return toHex(...to);
}

/** The least change that makes every pair the storefront renders text with read at AA
 *  (`contrastProblems` comes back empty): text colours move toward black or white, the
 *  backgrounds stay, and a main colour too light to carry any text darkens. */
export function readableColors(color: Color): Color {
  const out = { ...color };
  for (const k of ['text', 'muted', 'danger'] as const)
    out[k] = readableOn(out[k], [out.bg, out.surface]);
  if ((contrastRatio(out.onAccent, out.accent) ?? 0) < MIN) {
    out.onAccent = onColor(out.accent);
    if ((contrastRatio(out.onAccent, out.accent) ?? 0) < MIN) {
      out.accent = readableAccent(out.accent);
      out.onAccent = onColor(out.accent);
    }
  }
  return out;
}

const LIGHT = { ...TONES.claro, accent: '#123C32', onAccent: '#FFFFFF' };

/** The token set a store starts from before any edit (the light palette): the merchant
 *  admin's base and the Kernel's fallback agree on it. */
export const DEFAULT_TOKENS: StorefrontTokens = {
  color: { ...LIGHT },
  font: { display: 'Georgia, serif', body: 'system-ui, sans-serif' },
  radius: { sm: '6px', md: '10px', lg: '16px' },
  space: { scale: 1 },
  motion: { duration: '200ms', easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
};
