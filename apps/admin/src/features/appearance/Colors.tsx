import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { contrastRatio } from '@vendua/templates';
import { useEffect, useState } from 'react';
import type { StoreTokens } from '../../lib/api.ts';
import { cn } from '../../ui/cn.ts';
import { Chips, Field } from '../../ui/fields.tsx';

// Colours for people, not designers (§6.7): pick a palette (some from the store's
// own logo), fine-tune a swatch, and read "fácil de ler ✓" instead of a ratio.

type ColorKey = keyof StoreTokens['color'];

const EDITABLE: { key: ColorKey; label: string }[] = [
  { key: 'accent', label: 'Cor principal (botões)' },
  { key: 'bg', label: 'Fundo' },
  { key: 'surface', label: 'Cartões' },
  { key: 'text', label: 'Texto' },
  { key: 'muted', label: 'Texto secundário' },
];

const CHECKS: { fg: ColorKey; bg: ColorKey; label: string }[] = [
  { fg: 'text', bg: 'bg', label: 'Texto no fundo' },
  { fg: 'muted', bg: 'bg', label: 'Texto secundário' },
  { fg: 'text', bg: 'surface', label: 'Texto nos cartões' },
  { fg: 'onAccent', bg: 'accent', label: 'Texto dos botões' },
];

export const readable = (t: StoreTokens) =>
  CHECKS.every((c) => (contrastRatio(t.color[c.fg], t.color[c.bg]) ?? 0) >= 4.5) &&
  (contrastRatio(t.color.muted, t.color.surface) ?? 0) >= 4.5 &&
  (contrastRatio(t.color.danger, t.color.bg) ?? 0) >= 4.5 &&
  (contrastRatio(t.color.danger, t.color.surface) ?? 0) >= 4.5;

/** The text colour that reads best on a fill. */
function onColor(fill: string) {
  const w = contrastRatio('#ffffff', fill) ?? 0;
  const k = contrastRatio('#141414', fill) ?? 0;
  return w >= k ? '#FFFFFF' : '#141414';
}

function hex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();
}

/** Darken until it carries text at AA on the given background. */
function readableAccent(c: string) {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
  for (let i = 0; i < 20 && (contrastRatio(onColor(hex(r, g, b)), hex(r, g, b)) ?? 0) < 4.5; i++) {
    r *= 0.9;
    g *= 0.9;
    b *= 0.9;
  }
  return hex(r, g, b);
}

function paletteFrom(accentIn: string, base: StoreTokens, dark = false): StoreTokens {
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
    : {
        bg: '#FCFBF8',
        surface: '#FFFFFF',
        text: '#1A1714',
        muted: '#6B6456',
        accent,
        onAccent: onColor(accent),
        danger: '#B3372F',
        success: '#3D7A4F',
      };
  return { ...base, color };
}

/** A handful of saturated colours from the logo, most frequent first. */
async function logoColors(url: string): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, 48, 48);
  const d = g.getImageData(0, 0, 48, 48).data;
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < d.length; i += 4) {
    const [r, gg, b, a] = [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
    const max = Math.max(r, gg, b);
    const min = Math.min(r, gg, b);
    if (a < 200 || max - min < 40 || max < 40) continue; // skip greys, near-black, transparent
    const k = `${r >> 5}-${gg >> 5}-${b >> 5}`;
    const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += gg;
    e.b += b;
    buckets.set(k, e);
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((e) => hex(e.r / e.n, e.g / e.n, e.b / e.n));
}

const PRESETS: [string, string][] = [
  ['#AC5E10', 'caramelo'],
  ['#123C32', 'floresta'],
  ['#8E2C48', 'vinho'],
  ['#2456B0', 'azul'],
  ['#6B3FA0', 'uva'],
  ['#B3261E', 'morango'],
];

const RADII: Record<string, StoreTokens['radius']> = {
  reto: { sm: '2px', md: '4px', lg: '8px' },
  suave: { sm: '6px', md: '10px', lg: '16px' },
  redondo: { sm: '10px', md: '16px', lg: '24px' },
};

export function Colors({
  value,
  onChange,
  logoUrl,
}: {
  value: StoreTokens;
  onChange: (t: StoreTokens) => void;
  logoUrl: string | null;
}) {
  const [fromLogo, setFromLogo] = useState<string[]>([]);
  useEffect(() => {
    if (!logoUrl) return;
    logoColors(logoUrl).then(setFromLogo, () => setFromLogo([]));
  }, [logoUrl]);
  const radius = Object.entries(RADII).find(([, r]) => r.md === value.radius.md)?.[0] ?? '';
  const set = (k: ColorKey, v: string) => {
    const color = { ...value.color, [k]: v.toUpperCase() };
    if (k === 'accent') color.onAccent = onColor(v);
    onChange({ ...value, color });
  };
  return (
    <div className="space-y-6">
      <Field
        label="Paletas prontas"
        helper={fromLogo.length ? 'As primeiras saem das cores do seu logo.' : undefined}
      >
        <div className="flex flex-wrap gap-2">
          {[...fromLogo.map((c) => [c, 'do logo'] as [string, string]), ...PRESETS]
            .slice(0, 8)
            .map(([c, name], i) => (
              <button
                key={c + i}
                type="button"
                onClick={() => onChange(paletteFrom(c, value))}
                aria-pressed={value.color.accent === readableAccent(c)}
                className="flex h-12 items-center gap-2 rounded-full bg-surface pl-1.5 pr-3 ring-1 ring-line-strong hover:bg-hover aria-pressed:ring-2 aria-pressed:ring-primary"
                aria-label={`usar paleta ${name}`}
              >
                <span
                  className="size-9 rounded-full ring-2 ring-surface"
                  style={{ background: readableAccent(c) }}
                />
                <span className="t-caption font-semibold">{name}</span>
              </button>
            ))}
          <button
            type="button"
            onClick={() => onChange(paletteFrom(value.color.accent, value, true))}
            className="t-caption flex h-12 items-center rounded-full bg-[#14110F] px-4 font-semibold text-[#F5F1EA]"
          >
            versão escura
          </button>
        </div>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        {EDITABLE.map((e) => (
          <label key={e.key} className="flex min-h-14 items-center gap-3 rounded-md bg-sunken px-3">
            <input
              type="color"
              value={value.color[e.key].slice(0, 7)}
              onChange={(ev) => set(e.key, ev.target.value)}
              className="size-10 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0"
              aria-label={e.label}
            />
            <span className="min-w-0 flex-1">
              <span className="t-label block">{e.label}</span>
              <span className="t-caption tnum text-muted">{value.color[e.key]}</span>
            </span>
          </label>
        ))}
      </div>

      <ul className="space-y-1.5" aria-label="leitura">
        {CHECKS.map((c) => {
          const r = contrastRatio(value.color[c.fg], value.color[c.bg]) ?? 0;
          const ok = r >= 4.5;
          return (
            <li
              key={c.label}
              className={cn('t-body flex items-center gap-2', ok ? 'text-success' : 'text-danger')}
            >
              {ok ? (
                <CheckCircle weight="fill" className="size-5" />
              ) : (
                <WarningCircle weight="fill" className="size-5" />
              )}
              <span className="text-ink">{c.label}:</span>{' '}
              {ok ? 'fácil de ler ✓' : 'difícil de ler — ajuste a cor'}
            </li>
          );
        })}
      </ul>

      <Field label="Cantos">
        <Chips
          label="cantos"
          value={radius}
          onChange={(k) => onChange({ ...value, radius: RADII[k]! })}
          options={Object.keys(RADII).map((k) => ({ value: k, label: k }))}
        />
      </Field>

      <div>
        <p className="t-caption mb-2 font-semibold text-muted">Como fica</p>
        <div className="rounded-lg p-4" style={{ background: value.color.bg }}>
          <div
            className="p-4"
            style={{ background: value.color.surface, borderRadius: value.radius.lg }}
          >
            <p
              className="font-semibold"
              style={{ color: value.color.text, fontFamily: value.font.display }}
            >
              Pudim de leite
            </p>
            <p className="t-caption" style={{ color: value.color.muted }}>
              Lisinho, sem furinho, calda no ponto.
            </p>
            <span
              className="t-label mt-3 inline-flex h-10 items-center px-4"
              style={{
                background: value.color.accent,
                color: value.color.onAccent,
                borderRadius: value.radius.md,
              }}
            >
              Adicionar à sacola
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
