import { grid } from '../../lib/grid';

// The clock for picture and sound: scenes import these to animate, score.ts imports them to play.
// 96 BPM, 12 bars = exactly 30 s (a bar is 2.5 s). Times are seconds; b(n) is quarter-note n.
// A calm, cinematic cut (the author rejected the frenetic one): one idea per shot, held, with
// slow reveals and one deep hit on the date.
export const G = grid(96, 30);
const { b, bars } = G;
export const DURATION = bars(12);

/** The official launch date (the author's call, 2026-10-12). 16/10/2026 is a Friday. */
export const LAUNCH = { day: '16', month: '10', year: '2026', weekday: 'sexta-feira', long: '16 de outubro' } as const;

/** Each shot's span; shots crossfade over XF seconds after their end. */
export const SCENES = {
  open: [0, bars(2)],
  brand: [bars(2), bars(4)],
  features: [bars(4), bars(8)],
  date: [bars(8), bars(10)],
  end: [bars(10), bars(12)],
} as const;
export const XF = 0.5;

export const T = {
  open: { line1: 0.35, line2: bars(1) },
  brand: { mark: bars(2), word: b(10), tag1: bars(3), tag2: b(14) },
  date: { hit: bars(8), long: b(33), year: b(35), weekday: bars(9), rest: b(38) },
  end: { mark: bars(10), date: b(42), url: b(43), handle: b(44) },
};

/** The four product shots, one bar each: the line on the downbeat, the object's moment after it. */
export const FEATURE_IDS = ['pedido', 'pix', 'cardapio', 'dua'] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];
export const FEATURE = (i: number) => {
  const s = bars(4 + i);
  return { start: s, end: s + G.bar, at: (beat: number) => s + beat * G.beat };
};
/** Beats (within its bar) of each shot's moments. */
export const FEATURE_BEATS = {
  pedido: [1.25], // the push lands
  pix: [1.75], // paid
  cardapio: [1.25, 2], // two switches on
  dua: [1, 2.25], // the shopper asks, Duá answers
} as const;

export type Sfx = 'bloom' | 'boom' | 'air' | 'glass' | 'chime' | 'paid' | 'toggle' | 'bubble' | 'swell' | 'shimmer';

/** Every sound effect, at the time of the motion it belongs to. `n` varies pitch per repeat. */
export const SFX: { t: number; kind: Sfx; n?: number; dur?: number }[] = [
  { t: T.open.line2, kind: 'glass', n: 0 },
  { t: T.brand.mark, kind: 'bloom' },
  { t: T.brand.word, kind: 'shimmer' },
  { t: T.brand.tag1, kind: 'glass', n: 1 },
];
FEATURE_IDS.forEach((id, i) => {
  const f = FEATURE(i);
  const at = FEATURE_BEATS[id].map(f.at);
  SFX.push({ t: f.start - 0.35, kind: 'air', dur: 0.7 });
  if (id === 'pedido') SFX.push({ t: at[0], kind: 'chime' });
  if (id === 'pix') SFX.push({ t: at[0], kind: 'paid' });
  if (id === 'cardapio') at.forEach((t, n) => SFX.push({ t, kind: 'toggle', n }));
  if (id === 'dua') at.forEach((t, n) => SFX.push({ t, kind: 'bubble', n }));
});
SFX.push(
  { t: b(30), kind: 'swell', dur: T.date.hit - b(30) },
  { t: T.date.hit, kind: 'boom' },
  { t: T.date.year, kind: 'glass', n: 2 },
  { t: T.date.weekday, kind: 'glass', n: 3 },
  { t: T.end.mark - 0.35, kind: 'air', dur: 0.7 },
  { t: T.end.mark, kind: 'bloom' },
  { t: T.end.url, kind: 'glass', n: 4 },
);
