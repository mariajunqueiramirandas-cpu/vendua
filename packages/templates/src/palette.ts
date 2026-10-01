// One accent → the full colour set. The admin's appearance screen and Core's menu import
// both derive tokens here, so an imported brand colour looks the way picking it would.

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
  const color = dark
    ? {
        bg: '#14110F',
        surface: '#1E1A17',
        text: '#F5F1EA',
        muted: '#BDB3A5',
        accent,
        onAccent: onColor(accent),
        danger: '#FF8A7F',
        success: '#6FD39C',
      }
    : { ...LIGHT, accent, onAccent: onColor(accent) };
  return { ...base, color };
}

const LIGHT = {
  bg: '#FCFBF8',
  surface: '#FFFFFF',
  text: '#1A1714',
  muted: '#6B6456',
  accent: '#123C32',
  onAccent: '#FFFFFF',
  danger: '#B3372F',
  success: '#3D7A4F',
};

/** The token set a store starts from before any edit (the light palette): the merchant
 *  admin's base and the Kernel's fallback agree on it. */
export const DEFAULT_TOKENS: StorefrontTokens = {
  color: { ...LIGHT },
  font: { display: 'Georgia, serif', body: 'system-ui, sans-serif' },
  radius: { sm: '6px', md: '10px', lg: '16px' },
  space: { scale: 1 },
  motion: { duration: '200ms', easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
};
