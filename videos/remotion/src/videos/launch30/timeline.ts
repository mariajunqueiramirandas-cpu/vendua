import { grid } from '../../lib/grid';

// The clock for picture and sound: scenes import these to animate, score.ts imports them to play.
// 128 BPM, 16 bars = exactly 30 s. Times are seconds; b(n) is quarter-note n from 0.
// The film is a launch sequence: a mission clock counts down to T−0 while Venduá's systems are
// checked one per bar, Duá boots on the first drop, 3·2·1, and the date lands on the second.
export const G = grid(128, 30);
const { b, bars } = G;
export const DURATION = bars(16);

/** The official launch date (the author's call, 2026-10-12). 16/10/2026 is a Friday. */
export const LAUNCH = { day: '16', month: '10', year: '2026', weekday: 'sexta-feira' } as const;

export const SCENES = {
  hook: [0, bars(2)],
  checks: [bars(2), bars(7)],
  dua: [bars(7), bars(10)],
  ready: [bars(10), bars(12)],
  date: [bars(12), bars(14)],
  end: [bars(14), bars(16)],
} as const;

/** T−0: where the mission clock lands and the date drops. */
export const ZERO = bars(12);

export const T = {
  hook: { line1: 0, line2: b(2), seq: bars(1), scan: b(5), exit: b(7.5) },
  dua: {
    boot: bars(7),
    online: bars(8),
    sub: b(34),
    words: [
      [b(36), 'Responde.'],
      [b(37), 'Sugere.'],
      [b(38), 'Anota.'],
      [b(39), 'Cobra no Pix.'],
    ] as const,
    exit: b(39.5),
  },
  ready: {
    title: bars(10),
    ticks: [b(40), b(40.5), b(41), b(41.5), b(42), b(42.5)],
    go: b(43),
    count: [b(44), b(45), b(46)],
    ignite: b(47),
  },
  date: {
    pill: bars(12),
    // the reels land 1, 6, 1, 0 on the eighths after the drop
    digits: [b(48.5), b(49), b(49.5), b(50)],
    year: b(51),
    weekday: bars(13),
    exit: b(55.5),
  },
  end: { mark: bars(14), date: b(57), url: b(58), handle: b(59) },
};

/** The five checks, one bar each: the card enters on the downbeat, is stamped "pronto" on beat 2.5. */
export const CHECK_IDS = ['loja', 'pedido', 'pix', 'cozinha', 'cardapio'] as const;
export type CheckId = (typeof CHECK_IDS)[number];
export const CHECK = (i: number) => {
  const s = bars(2 + i);
  return { start: s, at: (beat: number) => s + beat * G.beat, ok: s + 2.5 * G.beat, exit: s + 3.5 * G.beat, end: s + G.bar };
};
/** Beats (within its bar) of each check's own moments. */
export const CHECK_BEATS = {
  loja: [0.5, 1, 1.5, 2], // four products added to the bag
  pedido: [0.25, 0.75, 1.75], // order #28 lands, #29 lands, "aceitar" tapped
  pix: [0.5, 1.25, 2.25], // Pix code shows, paid, the day's total settles
  cozinha: [0.25, 1.75], // printing starts, ticket torn
  cardapio: [0.5, 1, 1.5, 2], // four switches on
} as const;

/** Systems online so far (the HUD's bottom bar): one per stamp, Duá as the sixth. */
export const SYSTEMS = 6;
export const systemsAt = (t: number) =>
  CHECK_IDS.filter((_, i) => t >= CHECK(i).ok).length + (t >= T.dua.online ? 1 : 0);

/** Downbeats that hit: the camera shakes and the liquid gets a shockwave. */
export const HITS = [0, bars(1), ...CHECK_IDS.map((_, i) => CHECK(i).ok), bars(8), b(43), ...T.ready.count, ZERO, T.date.year, bars(14)] as const;
export const BIG_HITS = [bars(8), ZERO] as const;

export type Sfx =
  | 'impact'
  | 'drop'
  | 'whoosh'
  | 'swish'
  | 'pop'
  | 'bubble'
  | 'tick'
  | 'blip'
  | 'stamp'
  | 'notify'
  | 'tap'
  | 'paid'
  | 'print'
  | 'toggle'
  | 'riser'
  | 'count'
  | 'ignite'
  | 'launch'
  | 'reel'
  | 'shimmer'
  | 'ping';

/** Every sound effect, at the time of the motion it belongs to. `n` varies pitch per repeat. */
export const SFX: { t: number; kind: Sfx; n?: number; dur?: number }[] = [
  { t: 0, kind: 'impact' },
  { t: T.hook.line2, kind: 'pop', n: 2 },
  { t: T.hook.seq, kind: 'impact' },
  { t: T.hook.scan, kind: 'blip' },
  { t: T.hook.exit, kind: 'whoosh', dur: SCENES.hook[1] - T.hook.exit },
];

// checks
CHECK_IDS.forEach((id, i) => {
  const c = CHECK(i);
  const at = CHECK_BEATS[id].map(c.at);
  SFX.push({ t: c.start, kind: 'blip', n: i });
  if (id === 'loja') at.forEach((t, n) => SFX.push({ t, kind: 'pop', n }));
  if (id === 'pedido') SFX.push({ t: at[0], kind: 'notify', n: 0 }, { t: at[1], kind: 'notify', n: 1 }, { t: at[2], kind: 'tap' });
  if (id === 'pix') {
    SFX.push({ t: at[0], kind: 'swish' }, { t: at[1], kind: 'paid' });
    for (let k = 1; k < 10; k++) SFX.push({ t: at[1] + (at[2] - at[1]) * (1 - (1 - k / 10) ** (1 / 3)), kind: 'tick', n: k % 4 });
  }
  if (id === 'cozinha') SFX.push({ t: at[0], kind: 'print', dur: at[1] - at[0] }, { t: at[1], kind: 'swish' });
  if (id === 'cardapio') at.forEach((t, n) => SFX.push({ t, kind: 'toggle', n }));
  SFX.push({ t: c.ok, kind: 'stamp', n: i });
  if (i < CHECK_IDS.length - 1) SFX.push({ t: c.exit, kind: 'whoosh', dur: c.end - c.exit });
});

// Duá boots across bar 7, comes online on the drop
SFX.push(
  { t: T.dua.boot, kind: 'blip', n: 5 },
  { t: T.dua.boot, kind: 'riser', dur: bars(8) - T.dua.boot },
  { t: T.dua.online, kind: 'drop' },
  ...[0, 1, 2, 3, 4, 5].map((n) => ({ t: T.dua.online + b(0.5 + n * 0.5), kind: 'bubble' as const, n })),
  { t: T.dua.sub, kind: 'swish' },
  ...T.dua.words.map(([t], n) => ({ t, kind: 'tick' as const, n: n + 1 })),
  { t: T.dua.exit, kind: 'whoosh', dur: SCENES.dua[1] - T.dua.exit },
);

// all systems go, 3·2·1, ignition
SFX.push(
  { t: T.ready.title, kind: 'impact' },
  ...T.ready.ticks.map((t, n) => ({ t, kind: 'pop' as const, n })),
  { t: T.ready.go, kind: 'shimmer' },
  ...T.ready.count.map((t, n) => ({ t, kind: 'count' as const, n })),
  { t: T.ready.ignite, kind: 'ignite', dur: ZERO - T.ready.ignite },
);

// T−0: the date
SFX.push(
  { t: ZERO, kind: 'launch' },
  ...T.date.digits.map((t, n) => ({ t, kind: 'reel' as const, n })),
  { t: T.date.year, kind: 'impact' },
  { t: T.date.weekday, kind: 'shimmer' },
  { t: T.date.exit, kind: 'whoosh', dur: SCENES.date[1] - T.date.exit },
  { t: T.end.mark, kind: 'drop' },
  { t: T.end.date, kind: 'pop', n: 4 },
  { t: T.end.url, kind: 'ping' },
);

/** The day's sales on the Pix card: R$ 499,00 before order #29, R$ 718,00 after (the demo store's day). */
export const SALES_BEFORE = 49900;
export const SALES_AFTER = 71800;
