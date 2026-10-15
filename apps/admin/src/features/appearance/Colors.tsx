import { Check, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import {
  CONTRAST_PAIRS,
  contrastProblems,
  contrastRatio,
  normalizeHex,
  onColor,
  readableAccent,
  readableColors,
  toHex as hex,
  TONES,
  toneOf,
  withAccent,
  withNeutrals,
  type Tone,
} from '@vendua/templates';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { StoreTokens } from '../../lib/api.ts';
import { Button } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { MoreOptions } from '../../ui/Disclosure.tsx';
import { TextInput } from '../../ui/fields.tsx';

// Colours for people, not designers (§6.7): two choices made apart (the main colour, some from
// the store's own logo, and the tone of the page around it), the store's look as it is now
// always one of them, the rest colour by colour with its code for a brand guide, and "fácil de
// ler ✓" instead of a ratio, with a fix when it isn't.

type Color = StoreTokens['color'];
type ColorKey = keyof Color;

/** colour by colour, under the two choices: the main colour has its own row up top */
const FINE: { key: ColorKey; label: string; hint?: string }[] = [
  { key: 'onAccent', label: 'Texto dos botões' },
  { key: 'bg', label: 'Fundo da página' },
  { key: 'surface', label: 'Cartões', hint: 'Os quadros dos produtos e as caixas.' },
  { key: 'text', label: 'Texto' },
  { key: 'muted', label: 'Texto mais leve', hint: 'Detalhes, legendas e preços riscados.' },
];

const TONE_NAMES: Record<Tone, string> = { claro: 'Claro', creme: 'Creme', escuro: 'Escuro' };

// the merchant's words for the pairs the storefront renders text with (CONTRAST_PAIRS)
const PAIR_LABEL: Record<string, string> = {
  'text/bg': 'Texto no fundo',
  'text/surface': 'Texto nos cartões',
  'muted/bg': 'Texto mais leve',
  'muted/surface': 'Texto mais leve',
  'onAccent/accent': 'Texto dos botões',
  'danger/bg': 'Avisos (esgotado, erros)',
  'danger/surface': 'Avisos (esgotado, erros)',
};

/** One row per label: every pair it covers must read (AA, the Kernel build's own check). */
const CHECKS: { label: string; pairs: (typeof CONTRAST_PAIRS)[number][] }[] = [];
for (const pair of CONTRAST_PAIRS) {
  const label = PAIR_LABEL[`${pair[0]}/${pair[1]}`] ?? 'Outras cores';
  const row = CHECKS.find((c) => c.label === label);
  if (row) row.pairs.push(pair);
  else CHECKS.push({ label, pairs: [pair] });
}

/** The same check that blocks a release (`contrastProblems`), so publish never ships one. */
export const readable = (t: StoreTokens) => contrastProblems(t).length === 0;

/** A handful of saturated colours from the logo, most frequent first. */
export async function logoColors(url: string): Promise<string[]> {
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

export const PRESETS: [string, string][] = [
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

const same = (a: string, b: string) => normalizeHex(a) === normalizeHex(b);

export function Colors({
  value,
  onChange,
  logoUrl,
  published,
  sample,
}: {
  value: StoreTokens;
  onChange: (t: StoreTokens) => void;
  logoUrl: string | null;
  /** what the store looks like now: kept as one of the choices, so it's one tap away */
  published?: StoreTokens | null;
  /** a small "como fica" card, for when the live preview isn't on screen */
  sample?: boolean;
}) {
  const [fromLogo, setFromLogo] = useState<string[]>([]);
  useEffect(() => {
    if (!logoUrl) return;
    logoColors(logoUrl).then(setFromLogo, () => setFromLogo([]));
  }, [logoUrl]);
  const c = value.color;
  const setColor = (color: Color) => onChange({ ...value, color });

  // the logo's colours and the presets, made to carry text; the store's own first when it's
  // none of them
  const mains = useMemo(() => {
    const out: { hex: string; name: string; label: string }[] = [];
    const add = (raw: string, name: string, label = name) => {
      const h = normalizeHex(raw);
      if (h && !out.some((o) => o.hex === h)) out.push({ hex: h, name, label });
    };
    fromLogo.forEach((l, i) => add(readableAccent(l), 'do logo', `${i + 1}ª cor do logo`));
    for (const [p, name] of PRESETS) add(readableAccent(p), name);
    const now = published && normalizeHex(published.color.accent);
    if (now && !out.some((o) => o.hex === now))
      out.unshift({ hex: now, name: 'atual', label: 'a cor atual da loja' });
    return out;
  }, [fromLogo, published]);

  // the page's tones, and the store's own page colours when they're none of them
  const own = published && !toneOf(published.color) ? published.color : null;
  const tones: { id: string; name: string; colors: Color }[] = [
    ...(own ? [{ id: 'own', name: 'Atual', colors: own }] : []),
    ...(Object.keys(TONES) as Tone[]).map((t) => ({
      id: t,
      name: TONE_NAMES[t],
      colors: withNeutrals(c, TONES[t]),
    })),
  ];
  const toneOn = (x: Color) =>
    (['bg', 'surface', 'text', 'muted'] as const).every((k) => same(c[k], x[k]));
  // the corners, and the store's own when they're none of them
  const corners = Object.entries(RADII);
  const ownRadius = published?.radius;
  if (ownRadius && !corners.some(([, r]) => r.md === ownRadius.md))
    corners.unshift(['atual', ownRadius]);
  const radius = corners.find(([, r]) => r.md === value.radius.md)?.[0] ?? '';

  return (
    <div className="space-y-7">
      <Group title="Cor principal" hint="Vai nos botões, nos preços e nos destaques." radio>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-x-1 gap-y-3">
          {mains.map((m) => {
            const on = same(c.accent, m.hex);
            return (
              <button
                key={m.hex}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={m.label}
                onClick={() => setColor(withAccent(c, m.hex))}
                className="press group flex min-w-0 flex-col items-center gap-1.5 rounded-md py-1 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span
                  className={cn(
                    'grid size-11 place-items-center rounded-full ring-1 ring-inset ring-line-strong',
                    on && 'outline-2 outline-offset-2 outline-primary',
                  )}
                  style={{ background: m.hex, color: onColor(m.hex) }}
                >
                  {on ? <Check weight="bold" className="size-5" aria-hidden /> : null}
                </span>
                <span
                  className={cn(
                    't-caption max-w-full truncate',
                    on ? 'font-semibold text-ink' : 'text-muted',
                  )}
                >
                  {m.name}
                </span>
              </button>
            );
          })}
        </div>
        <ColorRow
          label="Outra cor"
          hint="Ou digite o código da sua marca."
          value={c.accent}
          onChange={(v) => setColor(withAccent(c, v))}
          className="mt-4"
        />
      </Group>

      <Group title="Fundo" hint="O tom da página e dos cartões em volta." radio>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-2">
          {tones.map((t) => {
            const on = toneOn(t.colors);
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setColor(withNeutrals(c, t.colors))}
                className="press flex min-w-0 flex-col gap-1.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {/* the page in that tone: a card with its title, a line and a button */}
                <span
                  aria-hidden
                  className={cn(
                    'relative block h-[4.5rem] w-full overflow-hidden rounded-md ring-1 ring-inset ring-line-strong',
                    on && 'outline-2 outline-offset-2 outline-primary',
                  )}
                  style={{ background: t.colors.bg }}
                >
                  <span
                    className="absolute inset-x-2 bottom-0 top-2 rounded-t-md px-2 pt-2"
                    style={{ background: t.colors.surface }}
                  >
                    <span
                      className="block h-1.5 w-4/5 rounded-full"
                      style={{ background: t.colors.text }}
                    />
                    <span
                      className="mt-1 block h-1.5 w-1/2 rounded-full"
                      style={{ background: t.colors.muted }}
                    />
                    <span
                      className="mt-2 block h-3 w-9 rounded-full"
                      style={{ background: c.accent }}
                    />
                  </span>
                </span>
                <span className="t-caption flex items-center gap-1 font-semibold">
                  {t.name}
                  {on ? (
                    <Check weight="bold" className="size-3.5 text-primary" aria-hidden />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </Group>

      <MoreOptions label="Ajuste fino" summary="Fundo, cartões e textos, cor por cor.">
        {FINE.map((f) => (
          <ColorRow
            key={f.key}
            label={f.label}
            hint={f.hint}
            value={c[f.key]}
            onChange={(v) => setColor({ ...c, [f.key]: v })}
          />
        ))}
      </MoreOptions>

      <Readability value={value} onFix={() => setColor(readableColors(c))} />

      <Group title="Cantos" hint="Dos botões, das fotos e dos cartões." radio>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-2">
          {corners.map(([k, r]) => {
            const on = radius === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ ...value, radius: r })}
                className={cn(
                  'press flex h-[4.5rem] flex-col items-center justify-center gap-2 rounded-md ring-1 ring-inset hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  on ? 'ring-2 ring-primary' : 'ring-line-strong',
                )}
              >
                {/* a card's corner, drawn at the size the store uses */}
                <span
                  aria-hidden
                  className="block h-6 w-12 border-l-2 border-t-2 border-ink"
                  style={{ borderTopLeftRadius: r.lg }}
                />
                <span className={cn('t-caption', on ? 'font-semibold text-ink' : 'text-muted')}>
                  {k}
                </span>
              </button>
            );
          })}
        </div>
      </Group>

      {sample ? <Sample value={value} /> : null}
    </div>
  );
}

/** A titled block of choices; `radio` makes it the radiogroup its buttons belong to. */
function Group({
  title,
  hint,
  radio,
  children,
}: {
  title: string;
  hint?: string;
  radio?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="t-label">
        {title}
      </h3>
      {hint ? <p className="t-caption mb-3 text-muted">{hint}</p> : null}
      {radio ? (
        <div role="radiogroup" aria-labelledby={id}>
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/** One colour: the swatch opens the phone's own picker, the field takes a brand's code
 *  (#A83248, A83248, rgb(…)) and applies it once it reads as a colour. */
function ColorRow({
  label,
  hint,
  value,
  onChange,
  className,
}: {
  label: string;
  hint?: string | undefined;
  value: string;
  onChange: (hex: string) => void;
  className?: string;
}) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const shown = normalizeHex(value) ?? '#000000';
  const parse = (v: string) => normalizeHex(/^[0-9a-f]{3,8}$/i.test(v.trim()) ? `#${v.trim()}` : v);
  const bad = typed !== null && typed.trim().length >= 3 && !parse(typed);
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <label
        className="relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full ring-1 ring-inset ring-line-strong has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
        style={{ background: shown }}
      >
        <span className="sr-only">escolher: {label}</span>
        <input
          type="color"
          value={shown.toLowerCase()}
          onChange={(e) => {
            setTyped(null);
            onChange(e.target.value.toUpperCase());
          }}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      <span className="min-w-0 flex-1">
        <label htmlFor={id} className="t-label block">
          {label}
        </label>
        {hint ? <span className="t-caption block text-muted">{hint}</span> : null}
      </span>
      <span className="w-[7.5rem] shrink-0">
        <TextInput
          id={id}
          value={typed ?? shown}
          maxLength={24}
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
          aria-invalid={bad || undefined}
          aria-describedby={bad ? `${id}-bad` : undefined}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setTyped(e.target.value);
            const h = parse(e.target.value);
            if (h && !same(h, value)) onChange(h);
          }}
          onBlur={() => setTyped(null)}
          className="tnum uppercase"
        />
      </span>
      {bad ? (
        <span id={`${id}-bad`} className="sr-only">
          não é um código de cor
        </span>
      ) : null}
    </div>
  );
}

/** One friendly line when everything reads well; the rows that don't, and a fix, when
 *  something doesn't. */
function Readability({ value, onFix }: { value: StoreTokens; onFix: () => void }) {
  const rows = CHECKS.map((c) => ({
    label: c.label,
    ok: c.pairs.every(([fg, bg]) => (contrastRatio(value.color[fg], value.color[bg]) ?? 0) >= 4.5),
  }));
  if (rows.every((r) => r.ok))
    return (
      <p className="t-body flex items-center gap-2 rounded-md bg-success-soft px-3 py-2.5 text-success">
        <CheckCircle weight="fill" className="size-5 shrink-0" />
        <span className="text-ink">Tudo fácil de ler ✓</span>
      </p>
    );
  return (
    <div className="space-y-3 rounded-md bg-danger-soft p-3" role="status">
      <div>
        <p className="t-label text-ink">
          Algumas cores estão difíceis de ler. Ajuste para publicar:
        </p>
        {/* the Kernel never renders an unreadable palette, not even as a draft */}
        <p className="t-caption text-muted">Até lá, a prévia mostra as cores de antes.</p>
      </div>
      <ul className="space-y-1.5" aria-label="leitura">
        {rows
          .filter((r) => !r.ok)
          .map((r) => (
            <li key={r.label} className="t-body flex items-center gap-2 text-danger">
              <WarningCircle weight="fill" className="size-5 shrink-0" />
              <span className="text-ink">{r.label}</span>
            </li>
          ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button size="sm" variant="secondary" onClick={onFix}>
          deixar fácil de ler
        </Button>
        <span className="t-caption text-muted">Muda só o que precisa. Dá para desfazer.</span>
      </div>
    </div>
  );
}

function Sample({ value }: { value: StoreTokens }) {
  return (
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
  );
}
