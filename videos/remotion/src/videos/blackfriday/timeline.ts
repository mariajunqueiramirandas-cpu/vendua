import { grid } from '../../lib/grid';

// The clock for picture and sound. The narrator's take sets the pace (VOICE.md): each line starts
// just after a cut on the 128 BPM eighth grid, the take's own pauses and breaths kept, each pause
// only ever lengthened (by less than an eighth) to land the next line on the grid. Times are seconds.
export const G = grid(128, 30);
const E = G.beat / 2;

/** One continuous read (sarah, take 3): every line from the same take, so timbre never jumps. */
export const TAKE = 'blackfriday/vo/sarah-3.mp3';

type Line = { on: number; off: number; w: Record<string, number> };
// on/off: first/last sound of the line in the take; w: word starts in the take (Whisper, checked by ear model)
const LINES = {
  hook: { on: 0, off: 1.865, w: { atencao: 0, quem: 0.82, vende: 0.88, comida: 1.14 } },
  brand: { on: 2.07, off: 3.765, w: { vem: 2.1, ai: 2.36, a: 2.6, vendua: 2.86 } },
  loja: { on: 3.98, off: 6.215, w: { sua: 4.0, loja: 4.2, online: 4.5, com: 4.88, cara: 5.62 } },
  pedidos: { on: 6.445, off: 8.735, w: { os: 6.47, pedidos: 6.58, caem: 6.96, direto: 7.24, no: 7.8, celular: 8.14 } },
  dua: {
    on: 8.99,
    off: 12.86,
    w: { e: 9.02, dua: 9.2, vendedor: 9.62, com: 10.06, ia: 10.36, atende: 10.98, fecha: 11.52, pedido: 11.84, whatsapp: 12.3 },
  },
  comissao: { on: 13.165, off: 14.79, w: { zero: 13.2, comissao: 13.54, por: 14.04, pedido: 14.18 } },
  launch: {
    on: 15.025,
    off: 18.63,
    w: { lancamento: 15.05, oficial: 15.44, na: 15.88, black: 16.06, friday: 16.32, sexta: 17.02, dia: 17.46, d27: 17.66 },
  },
  desconto: { on: 18.81, off: 20.825, w: { com: 18.84, super: 19.06, desconto: 19.48, de: 19.94, lancamento: 20.1 } },
  cta: { on: 20.94, off: 24.14, w: { anota: 20.96, ai: 21.24, vendua: 22.0, com: 22.5, br: 23.1 } },
} satisfies Record<string, Line>;
export type FrameId = keyof typeof LINES;
const ORDER = Object.keys(LINES) as FrameId[];

// Quietest point of each pause in the take: a line's audio runs from its cut to the next one.
const CUTS = [0, 1.875, 3.775, 6.215, 8.765, 12.84, 14.77, 18.59, 20.89, 24.24];

/** The voice starts this long after its frame's cut. */
const LEAD = 0.07;
const FIRST = 0.08;

// delay of each line in the video against the take; never shrinks, so pauses only grow
const delay: number[] = [];
const starts: number[] = [];
ORDER.forEach((id, i) => {
  const on = LINES[id].on;
  if (i === 0) {
    delay.push(FIRST - on);
    starts.push(0);
    return;
  }
  const cut = Math.ceil((on + delay[i - 1] - LEAD) / E - 1e-9) * E;
  starts.push(cut);
  delay.push(cut + LEAD - on);
});

/** The final chord: the first downbeat as the address is being said; one bar rings out after it. */
const DROP_AT = starts[ORDER.indexOf('launch')];
// The music's bars are anchored on the drop ("Lançamento oficial"); the opening is a pickup.
export const PHASE = DROP_AT - Math.floor(DROP_AT / G.bar + 1e-9) * G.bar;
/** Downbeat of music bar n (bar 0 = the first full bar after the pickup). */
export const bar = (n: number) => PHASE + n * G.bar;
export const barAt = (t: number) => Math.floor((t - PHASE) / G.bar + 1e-9);
const ctaEnd = LINES.cta.off + delay[ORDER.indexOf('cta')];
export const FINAL = bar(Math.ceil((ctaEnd - 0.3 - PHASE) / G.bar - 1e-9));
export const DURATION = FINAL + G.bar;

export type Frame = { start: number; end: number; voice: [number, number]; w: Record<string, number> };
export const F = Object.fromEntries(
  ORDER.map((id, i) => {
    const d = delay[i];
    const l: Line = LINES[id];
    const end = i + 1 < ORDER.length ? starts[i + 1] : DURATION;
    const w = Object.fromEntries(Object.entries(l.w).map(([k, v]) => [k, v + d]));
    if (l.off + d > end + 1e-6) throw new Error(`${id}: the line runs past its frame`);
    return [id, { start: starts[i], end, voice: [l.on + d, l.off + d], w } satisfies Frame];
  }),
) as Record<FrameId, Frame>;

/** The take cut at its pauses and placed on the video's clock (render-audio.mjs mixes these). */
export const VOICE = ORDER.map((_, i) => ({ src: TAKE, from: CUTS[i], to: CUTS[i + 1], at: CUTS[i] + delay[i] }));
/** Where someone is talking: the music and effects duck under these. */
export const SPEECH = ORDER.map((id) => F[id].voice);

export const DROP = F.launch.start;
/** The beat before the drop goes silent. */
export const GAP = DROP - E;

// ── cues the scenes animate on and the score plays on ──
const { hook, brand, loja, pedidos, dua, comissao, launch, desconto, cta } = F;
export const T = {
  hook: {
    // the category reel spins under "quem vende" and locks on "comida"
    roll: [hook.w.vende + 0.02, hook.w.vende + 0.1, hook.w.vende + 0.18, hook.w.vende + 0.26] as const,
    lock: hook.w.comida + 0.06,
  },
  brand: { letters: brand.w.vendua - 0.04, mark: brand.w.vendua + 0.32 },
  loja: { phone: loja.start, url: loja.w.online + 0.05, theme: loja.w.cara },
  pedidos: { phone: pedidos.start, push: [pedidos.w.caem, pedidos.w.caem + G.beat] as const, badge: pedidos.w.celular + 0.1 },
  dua: {
    avatar: dua.w.dua,
    chip: dua.w.ia,
    chat: dua.w.ia + 0.42,
    // shopper, Duá, shopper, Duá with the Pix, paid: on "atende", "fecha", "pedido" and "WhatsApp"
    msgs: [dua.w.atende - 0.06, dua.w.atende + E, dua.w.fecha, dua.w.pedido, dua.w.whatsapp] as const,
  },
  comissao: { zero: comissao.w.zero, rise: comissao.start + G.beat, gap: GAP },
  launch: { label: launch.w.lancamento, black: launch.w.black, friday: launch.w.friday, card: launch.w.sexta, d27: launch.w.d27 },
  desconto: { tag: desconto.start, super: desconto.w.super, desconto: desconto.w.desconto, sub: desconto.w.de },
  cta: { open: cta.start, anota: cta.w.anota, url: [cta.w.vendua, cta.w.com, cta.w.br] as const, final: FINAL },
};

/** Downbeats the camera feels: a small shake and nothing else. */
export const HITS = [0, DROP, FINAL] as const;

export type Sfx = 'impact' | 'drop' | 'whoosh' | 'swish' | 'pop' | 'bubble' | 'tick' | 'chime' | 'lock' | 'shimmer' | 'riser' | 'stamp' | 'button';

/** Every effect, on the motion it belongs to. `n` steps the pitch of repeats. */
export const SFX: { t: number; kind: Sfx; n?: number; dur?: number }[] = [
  { t: 0, kind: 'impact' },
  ...T.hook.roll.map((t, n) => ({ t, kind: 'tick' as const, n })),
  { t: T.hook.lock, kind: 'lock' },
  { t: brand.start - 0.15, kind: 'whoosh', dur: 0.15 },
  { t: T.brand.letters, kind: 'shimmer' },
  { t: T.loja.phone, kind: 'swish' },
  { t: T.loja.url, kind: 'pop', n: 2 },
  { t: T.loja.theme, kind: 'swish' },
  { t: T.pedidos.phone, kind: 'swish' },
  { t: T.pedidos.push[0], kind: 'chime' },
  { t: T.pedidos.push[1], kind: 'pop', n: 3 },
  { t: T.dua.avatar, kind: 'pop', n: 0 },
  { t: T.dua.chip, kind: 'tick', n: 4 },
  { t: T.dua.chat, kind: 'swish' },
  ...T.dua.msgs.map((t, n) => ({ t, kind: 'bubble' as const, n })),
  { t: T.comissao.zero, kind: 'lock', n: 1 },
  { t: comissao.start, kind: 'riser', dur: GAP - comissao.start },
  { t: DROP, kind: 'drop' },
  { t: T.launch.black, kind: 'stamp', n: 0 },
  { t: T.launch.friday, kind: 'stamp', n: 1 },
  { t: T.launch.card, kind: 'swish' },
  { t: T.launch.d27, kind: 'lock', n: 2 },
  { t: T.desconto.desconto, kind: 'stamp', n: 2 },
  { t: T.cta.open, kind: 'swish' },
  ...T.cta.url.map((t, n) => ({ t, kind: 'tick' as const, n: n + 2 })),
  { t: FINAL, kind: 'impact' },
  { t: FINAL, kind: 'button' },
];
