import { grid } from '../../lib/grid';

// The clock for picture and sound: scenes import these to animate, score.ts imports them to play.
// 128 BPM, 16 bars = exactly 30 s. Times are seconds.
export const G = grid(128, 30);
const { b, bars } = G;
export const DURATION = bars(16);

export const SCENES = {
  hook: [0, bars(2)],
  brand: [bars(2), bars(4)],
  orders: [bars(4), bars(8)],
  dua: [bars(8), bars(12)],
  plans: [bars(12), bars(14)],
  cta: [bars(14), bars(16)],
} as const;

export const T = {
  hook: { line1: 0, sub: b(2), line2: bars(1), scribble: bars(1) + b(0.75), exit: b(7) },
  brand: { converge: bars(2), mark: b(9), tag1: bars(3), tag2: b(13), explode: b(15) },
  orders: {
    line1: bars(4),
    line2: b(17),
    // order cards: on the beat, then eighths as the shop gets busy
    cards: [b(18), b(19), b(20), b(21), b(22), b(22.5), b(23), b(23.5)],
    counter: bars(6),
    counterEnd: bars(6) + b(3),
    build: bars(7),
    words: [b(28), b(29), b(30), b(31)],
  },
  dua: {
    line1: bars(8),
    line2: b(33),
    sub1: b(34),
    sub2: b(35),
    chat: bars(9),
    // one message per beat, the Pix card and the confirmation get a beat and a half
    msgs: [b(36), b(37), b(38), b(39), b(40), b(41), b(42), b(43.5), b(44.5)],
    words: [
      [b(36), 'Responde.'],
      [b(38), 'Sugere.'],
      [b(40), 'Anota.'],
      [b(42), 'Cobra no Pix.'],
      [b(44.5), 'Vendido.'],
    ] as const,
    exit: b(47),
  },
  plans: {
    mirim: bars(12),
    mirimLock: b(49),
    mirimPerks: b(50),
    flip: b(51),
    bandeira: bars(13),
    bandeiraLock: b(53),
    perks: [b(53.5), b(54), b(54.5), b(55)],
    sweep: b(54),
  },
  cta: {
    line1: bars(14),
    line2: b(57),
    noCard: b(58),
    pill: b(58.5),
    iris: b(59.5),
    end: bars(15),
    url: b(60.5),
    tag: b(61),
  },
};

/** Downbeats that hit: the camera shakes and the liquid gets a shockwave. */
export const HITS = [0, bars(1), bars(2), bars(4), bars(8), bars(12), bars(14), bars(15)] as const;
export const BIG_HITS = [bars(8), bars(15)] as const;

export type Sfx =
  | 'impact'
  | 'drop'
  | 'whoosh'
  | 'swish'
  | 'pop'
  | 'bubble'
  | 'tick'
  | 'ping'
  | 'chime'
  | 'lock'
  | 'shimmer'
  | 'tap'
  | 'riser'
  | 'scribble';

/** Every sound effect, at the time of the motion it belongs to. `n` varies pitch per repeat. */
export const SFX: { t: number; kind: Sfx; n?: number; dur?: number }[] = [
  { t: 0, kind: 'impact' },
  { t: T.hook.sub, kind: 'tick' },
  { t: T.hook.line2, kind: 'impact' },
  { t: T.hook.scribble, kind: 'scribble' },
  { t: T.hook.exit, kind: 'whoosh', dur: SCENES.hook[1] - T.hook.exit },
  { t: T.brand.converge, kind: 'impact' },
  { t: T.brand.mark, kind: 'shimmer' },
  { t: T.brand.tag1, kind: 'pop', n: 0 },
  { t: T.brand.tag2, kind: 'pop', n: 2 },
  { t: T.brand.explode, kind: 'whoosh', dur: SCENES.brand[1] - T.brand.explode },
  { t: T.orders.line1, kind: 'swish' },
  ...T.orders.cards.map((t, n) => ({ t, kind: 'pop' as const, n })),
  { t: T.orders.counter, kind: 'swish' },
  { t: T.orders.counterEnd, kind: 'chime' },
  { t: T.orders.build, kind: 'riser', dur: SCENES.orders[1] - T.orders.build },
  ...T.orders.words.map((t, n) => ({ t, kind: 'tick' as const, n })),
  { t: T.dua.line1, kind: 'drop' },
  { t: T.dua.sub1, kind: 'pop', n: 1 },
  { t: T.dua.chat, kind: 'swish' },
  ...T.dua.msgs.map((t, n) => ({ t, kind: 'bubble' as const, n })),
  { t: T.dua.msgs[8], kind: 'chime' },
  { t: T.dua.exit, kind: 'whoosh', dur: SCENES.dua[1] - T.dua.exit },
  { t: T.plans.mirim, kind: 'impact' },
  { t: T.plans.mirimLock, kind: 'lock' },
  { t: T.plans.flip, kind: 'swish' },
  { t: T.plans.bandeiraLock, kind: 'lock', n: 1 },
  ...T.plans.perks.map((t, n) => ({ t, kind: 'tick' as const, n: n + 2 })),
  { t: T.plans.sweep, kind: 'shimmer' },
  { t: T.cta.line1, kind: 'impact' },
  { t: T.cta.noCard, kind: 'pop', n: 3 },
  { t: T.cta.iris, kind: 'whoosh', dur: T.cta.end - T.cta.iris },
  { t: T.cta.end, kind: 'drop' },
  { t: T.cta.url, kind: 'ping' },
];

// The sales counter rolls to R$ 718,00 (the demo store's day on the admin screen) on an out-cubic
// curve; the score ticks where that curve crosses each eighteenth, so the ticks slow as it lands.
const outCubic = (x: number) => 1 - (1 - x) ** 3;
export const COUNTER_CENTS = 71800;
export const counterAt = (t: number) => {
  const { counter, counterEnd } = T.orders;
  const x = Math.min(1, Math.max(0, (t - counter) / (counterEnd - counter)));
  return Math.round(outCubic(x) * COUNTER_CENTS);
};
const TICKS = 18;
for (let i = 1; i < TICKS; i++) {
  const x = 1 - (1 - i / TICKS) ** (1 / 3);
  SFX.push({ t: T.orders.counter + x * (T.orders.counterEnd - T.orders.counter), kind: 'tick', n: i % 4 });
}
