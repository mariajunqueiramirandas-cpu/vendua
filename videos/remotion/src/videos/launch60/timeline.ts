import acompanha from '../../../public/launch60/ui/acompanha.json';
import compra from '../../../public/launch60/ui/compra.json';
import inicio from '../../../public/launch60/ui/inicio.json';
import loja from '../../../public/launch60/ui/loja.json';
import monta from '../../../public/launch60/ui/monta.json';
import noar from '../../../public/launch60/ui/noar.json';
import pedidos from '../../../public/launch60/ui/pedidos.json';
import seudia from '../../../public/launch60/ui/seudia.json';
import { grid } from '../../lib/grid';
import { LINES } from './lines';
import { WORDS } from './words';

// The clock for picture and sound. The voice sets the pace: each scene is its take plus a tail,
// rounded up to whole eighths of the 128 BPM grid, and the last scene (the CTA and end card) runs
// to exactly 60 s (32 bars). Scenes read cue times off the takes' word times, so a new take moves
// every cut, caption and sound effect with it. Times are seconds.
export const G = grid(128, 30);
export const E = G.beat / 2;
export const DURATION = G.bars(32);

export type LineId =
  | 'hook'
  | 'pain'
  | 'launch'
  | 'who'
  | 'what'
  | 'shop'
  | 'order'
  | 'dua'
  | 'day'
  | 'setup'
  | 'price'
  | 'cta';
export const IDS = LINES.map((l) => l.id) as LineId[];

// silence after each line's last word before the next cut: the launch holds for its reveal, the
// order for its "aceito" chime, the rest just breathe
const TAIL: Record<Exclude<LineId, 'cta'>, number> = {
  hook: 0.3,
  pain: 0.3,
  launch: 1.25,
  who: 0.15,
  what: 0.45,
  shop: 0.55,
  order: 0.75,
  dua: 0.5,
  day: 0.6,
  setup: 0.35,
  price: 0.45,
};
// the word that should land on the grid: its take slides (≤ 0.12 s) so the hit is on an eighth
const ACCENT: Partial<Record<LineId, number>> = { launch: 6 };

const up = (s: number) => Math.ceil(s / E - 1e-6) * E;

export type Word = { w: string; t0: number; t1: number };
export const VO = {} as Record<LineId, { at: number; dur: number; words: Word[] }>;
export const SCENES = {} as Record<LineId, readonly [number, number]>;

let cut = 0;
for (const id of IDS) {
  const take = WORDS[id];
  let at = cut;
  const k = ACCENT[id];
  if (k !== undefined) {
    const hit = cut + take.words[k][1];
    const d = Math.round(hit / E) * E - hit;
    if (Math.abs(d) <= 0.12) at += d;
  }
  VO[id] = { at, dur: take.duration, words: take.words.map(([w, t0, t1]) => ({ w, t0: at + t0, t1: at + t1 })) };
  const end = id === 'cta' ? DURATION : up(at + take.words[take.words.length - 1][2] + TAIL[id]);
  SCENES[id] = [cut, end];
  cut = end;
}

/** Start of the first word of line `id` that begins with `text` (case and accents ignored). */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
export const at = (id: LineId, text: string, nth = 0) => {
  const hits = VO[id].words.filter((w) => fold(w.w).startsWith(fold(text)));
  if (!hits[nth]) throw new Error(`no "${text}" in ${id}`);
  return hits[nth].t0;
};
const lastWord = (id: LineId) => VO[id].words[VO[id].words.length - 1];

export const T = {
  hook: {
    para: at('hook', 'para'),
    perder: at('hook', 'perder'),
    pedido: at('hook', 'pedido'),
    whats: at('hook', 'whatsapp'),
    // shoppers' messages piling up on the eighths; the last one gives up
    notes: [0, 1, 2, 3, 4, 5, 7].map((k) => k * E),
  },
  pain: { cliente: at('pain', 'cliente'), caderno: at('pain', 'pedido'), pix: at('pain', 'pix'), print: at('pain', 'print') },
  launch: { neste: at('launch', 'neste'), sabado: at('launch', 'sabado'), entra: at('launch', 'entra'), brand: at('launch', 'vendua') },
  who: {
    words: [at('who', 'doceiras'), at('who', 'marmitarias'), at('who', 'hamburguerias'), at('who', 'padarias')],
  },
  what: { loja: at('what', 'loja'), cara: at('what', 'cara'), app: at('what', 'app'), dia: at('what', 'dia') },
  shop: { escolhe: at('shop', 'escolhe'), monta: at('shop', 'monta'), paga: at('shop', 'paga'), pix: at('shop', 'pix'), sem: at('shop', 'sem') },
  order: { cai: at('order', 'cai'), celular: at('order', 'celular'), toque: at('order', 'toque'), aceito: at('order', 'aceito') },
  dua: {
    whats: at('dua', 'whatsapp'),
    dua: at('dua', 'dua'),
    vendedor: at('dua', 'vendedor'),
    ia: at('dua', 'inteligencia'),
    tira: at('dua', 'tira'),
    monta: at('dua', 'monta'),
    manda: at('dua', 'manda'),
  },
  day: { fim: at('day', 'fim'), quanto: at('day', 'quanto'), vendeu: at('day', 'vendeu'), saiu: at('day', 'saiu') },
  setup: {
    responder: at('setup', 'responder'),
    cerca: at('setup', 'em'),
    hora: at('setup', 'hora'),
    loja: at('setup', 'loja'),
    ar: at('setup', 'ar'),
  },
  price: {
    nenhuma: at('price', 'nenhuma'),
    taxa: at('price', 'taxa'),
    por: at('price', 'por'),
    planos: at('price', 'planos'),
    partir: at('price', 'partir'),
    valor: at('price', '69'),
    mes: at('price', 'mes'),
  },
  cta: {
    sabado: at('cta', 'sabado'),
    dias: at('cta', '14'),
    sem: at('cta', 'sem'),
    link: at('cta', 'link'),
    // the end card: the beat after "bio"
    end: up(lastWord('cta').t1 + 0.05),
  },
};

// Duá's chat, on the WhatsApp line: the shopper asks, Duá answers, sums up and sends the Pix
export const CHAT = [
  { t: T.dua.whats + 0.1, me: true },
  { t: T.dua.tira, me: false },
  { t: T.dua.tira + 0.5, me: true },
  { t: T.dua.monta, me: false },
  { t: T.dua.monta + 0.55, me: true },
  { t: T.dua.manda, me: false },
  { t: T.dua.manda + 0.3, me: false },
] as const;

// ── the real UI clips (scripts/capture-ui.mjs) and how each one's time maps onto the film ──
export type Clip = 'loja' | 'compra' | 'pedidos' | 'acompanha' | 'inicio' | 'seudia' | 'monta' | 'noar';
type Meta = { frames: number; viewport: { width: number; height: number }; marks: Record<string, number>; taps: { f: number; x: number; y: number; label: string }[] };
export const UI: Record<Clip, Meta> = { loja, compra, pedidos, acompanha, inicio, seudia, monta, noar };

/** A clip on screen from `from` to `to`, its frame at time t read off [time, frame] keys:
 *  straight lines between them (speed ramps), held before the first and after the last. */
export type Shot = { clip: Clip; from: number; to: number; keys: [number, number][] };
const m = (c: Clip, k: string) => UI[c].marks[k];
export const SHOTS: Record<'loja' | 'inicio' | 'compra' | 'acompanha' | 'pedidos' | 'seudia' | 'monta' | 'noar', Shot> = {
  loja: { clip: 'loja', from: SCENES.what[0], to: SCENES.what[1], keys: [[SCENES.what[0], 0], [T.what.app, 74]] },
  inicio: { clip: 'inicio', from: T.what.app - 0.25, to: SCENES.what[1], keys: [[T.what.app, 0], [T.what.dia - 0.5, m('inicio', 'rola')], [SCENES.what[1], 62]] },
  compra: {
    clip: 'compra',
    from: SCENES.shop[0],
    to: T.shop.sem + 0.45,
    keys: [
      [SCENES.shop[0], 0],
      [T.shop.escolhe, m('compra', 'produto')],
      [T.shop.escolhe + 0.45, m('compra', 'adicionar')],
      [T.shop.monta, 58],
      [T.shop.monta + 0.45, m('compra', 'pagar')],
      [T.shop.monta + 0.6, m('compra', 'dados')],
      [T.shop.paga - 0.12, m('compra', 'continuar')],
      [T.shop.paga + 0.04, m('compra', 'retirada')],
      [T.shop.paga + 0.2, m('compra', 'continuar2')],
      [T.shop.pix, m('compra', 'confirmar')],
      [T.shop.sem, 178],
      [T.shop.sem + 0.45, 206],
    ],
  },
  acompanha: { clip: 'acompanha', from: T.shop.sem + 0.45, to: SCENES.shop[1], keys: [[T.shop.sem + 0.45, 0], [SCENES.shop[1], 30]] },
  pedidos: {
    clip: 'pedidos',
    from: SCENES.order[0],
    to: SCENES.order[1],
    keys: [
      [SCENES.order[0], 0],
      [T.order.cai, m('pedidos', 'chegou')],
      [T.order.celular - 0.45, 40],
      [T.order.celular - 0.1, m('pedidos', 'pagoVisto')],
      [T.order.toque, m('pedidos', 'aceitar')],
      [SCENES.order[1], 145],
    ],
  },
  seudia: { clip: 'seudia', from: SCENES.day[0], to: SCENES.day[1], keys: [[SCENES.day[0], 0], [SCENES.day[1], 89]] },
  monta: {
    clip: 'monta',
    from: SCENES.setup[0],
    to: T.setup.cerca + 0.55,
    keys: [
      [SCENES.setup[0], 0],
      [T.setup.responder - 0.7, 22],
      [T.setup.responder - 0.25, 40],
      [T.setup.responder - 0.04, m('monta', 'comecar')],
      [T.setup.responder + 0.18, m('monta', 'nome')],
      [T.setup.responder + 0.58, 66],
      [T.setup.responder + 0.78, m('monta', 'continuar')],
      [T.setup.responder + 1.02, m('monta', 'logo')],
      [T.setup.responder + 1.3, m('monta', 'cor')],
      [T.setup.cerca, 108],
      [T.setup.cerca + 0.2, m('monta', 'cor2')],
      [T.setup.cerca + 0.55, 126],
    ],
  },
  noar: { clip: 'noar', from: T.setup.hora + 0.35, to: SCENES.setup[1], keys: [[T.setup.hora + 0.35, 2], [SCENES.setup[1], 56]] },
};

/** the clip frame a shot shows at time t */
export const frameAt = (s: Shot, t: number) => {
  const k = s.keys;
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++)
    if (t <= k[i][0]) return k[i - 1][1] + ((t - k[i - 1][0]) / (k[i][0] - k[i - 1][0])) * (k[i][1] - k[i - 1][1]);
  return k[k.length - 1][1];
};
/** when a shot first reaches clip frame f */
export const timeOf = (s: Shot, f: number) => {
  const k = s.keys;
  for (let i = 1; i < k.length; i++)
    if (f <= k[i][1]) return k[i - 1][0] + ((f - k[i - 1][1]) / (k[i][1] - k[i - 1][1] || 1)) * (k[i][0] - k[i - 1][0]);
  return k[k.length - 1][0];
};
/** each recorded tap of a shot, at the time it lands on screen */
export const tapsOf = (s: Shot) =>
  UI[s.clip].taps.map((p) => ({ ...p, t: timeOf(s, p.f) })).filter((p) => p.t >= s.from && p.t < s.to);

/** Cuts and hits: the camera shakes and the liquid gets a shockwave. */
export const HITS = [0, T.launch.brand, SCENES.who[0], SCENES.shop[0], T.order.aceito, SCENES.dua[0], SCENES.price[0], T.cta.end] as const;
export const BIG_HITS = [T.launch.brand, T.cta.end] as const;

/** Caption groups: break on punctuation, at most three words or ~18 characters. */
export type Caption = { t0: number; t1: number; words: Word[] };
export const CAPTIONS: Caption[] = [];
for (const id of IDS) {
  const ws = VO[id].words;
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) CAPTIONS.push({ t0: cur[0].t0, t1: cur[cur.length - 1].t1, words: cur });
    cur = [];
  };
  for (const w of ws) {
    const len = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    if (cur.length >= 3 || (cur.length && len > 18)) flush();
    cur.push(w);
    if (/[,.:!?…]$/.test(w.w)) flush();
  }
  flush();
}
// each group stays until the next starts (or a short tail), never across its scene's cut
for (let i = 0; i < CAPTIONS.length; i++) {
  const c = CAPTIONS[i];
  const scene = Object.values(SCENES).find(([a, b]) => c.t0 >= a - 0.2 && c.t0 < b)!;
  const next = CAPTIONS[i + 1]?.t0 ?? DURATION;
  c.t1 = Math.min(next - 0.02, c.t1 + 0.35, scene[1] - 0.02, T.cta.end - 0.02);
}

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
  | 'scribble'
  | 'buzz'
  | 'order'
  | 'paid';

/** The order-number roll on the price: R$ 0,00 → R$ 69,90 between these two times. */
export const COUNT = [T.price.partir, T.price.valor + 0.3] as const;
/** The clock in the setup scene runs a fast hour between these two times. */
export const CLOCK = [T.setup.cerca + 0.1, T.setup.hora + 0.35] as const;

/** Every sound effect, at the time of the motion it belongs to. `n` varies pitch per repeat. */
export const SFX: { t: number; kind: Sfx; n?: number; dur?: number }[] = [
  // hook: the phone won't stop buzzing
  { t: 0, kind: 'impact' },
  { t: 0.02, kind: 'buzz' },
  // (n from 10: a notification, pitched up the ladder; 0 and 1: Duá's and the shopper's bubbles)
  ...T.hook.notes.map((t, k) => ({ t: t + 0.03, kind: 'bubble' as const, n: 10 + k })),
  { t: T.hook.notes[6] + E, kind: 'buzz' },
  // pain: a clock, a notebook, a screenshot of a Pix
  { t: SCENES.pain[0], kind: 'swish' },
  ...[0, 1, 2, 3, 4].map((k) => ({ t: T.pain.cliente + k * E, kind: 'tick' as const, n: k })),
  { t: T.pain.caderno, kind: 'scribble' },
  { t: T.pain.caderno + 0.45, kind: 'scribble' },
  { t: T.pain.pix, kind: 'swish' },
  { t: T.pain.print, kind: 'lock' },
  { t: SCENES.launch[0], kind: 'riser', dur: T.launch.brand - SCENES.launch[0] },
  // launch: the date stamps, the brand drops
  { t: T.launch.sabado, kind: 'lock' },
  { t: T.launch.entra, kind: 'pop', n: 2 },
  { t: T.launch.brand, kind: 'drop' },
  { t: T.launch.brand + 0.12, kind: 'shimmer' },
  // who: one sticker per trade
  ...T.who.words.map((t, n) => ({ t, kind: 'pop' as const, n: n + 1 })),
  // what: the shop's phone, then the admin's, and a sale rolling in
  { t: SCENES.what[0] - 0.3, kind: 'whoosh', dur: 0.3 },
  { t: T.what.loja, kind: 'swish' },
  { t: T.what.app, kind: 'swish' },
  ...[0, 1, 2, 3, 4, 5].map((k) => ({ t: timeOf(SHOTS.inicio, UI.inicio.marks.rola) + k * 0.05, kind: 'tick' as const, n: k + 2 })),
  { t: timeOf(SHOTS.inicio, UI.inicio.marks.rola) + 0.34, kind: 'ping' },
  // shop: every tap of the real purchase, the Pix, the payment confirmed
  ...tapsOf(SHOTS.compra).map((p) => ({ t: p.t, kind: 'tap' as const })),
  { t: timeOf(SHOTS.compra, UI.compra.marks.pix + 4), kind: 'ping' },
  { t: SHOTS.acompanha.from + 0.08, kind: 'chime' },
  // order: the push lands, it's paid, one tap (the admin's own two sounds, apps/admin/src/lib/sound.ts)
  { t: T.order.cai, kind: 'order' },
  { t: timeOf(SHOTS.pedidos, UI.pedidos.marks.pagoVisto), kind: 'paid' },
  ...tapsOf(SHOTS.pedidos).map((p) => ({ t: p.t, kind: 'tap' as const })),
  { t: T.order.aceito, kind: 'chime' },
  // dua: the chat, Duá himself, the Pix
  { t: SCENES.dua[0] - 0.3, kind: 'whoosh', dur: 0.3 },
  ...CHAT.map((c, n) => ({ t: c.t, kind: 'bubble' as const, n: c.me ? 1 : 0 })),
  { t: T.dua.dua, kind: 'shimmer' },
  { t: T.dua.ia, kind: 'lock' },
  { t: T.dua.manda + 0.3, kind: 'ping' },
  // day: the night's numbers
  { t: SCENES.day[0], kind: 'swish' },
  { t: T.day.vendeu, kind: 'pop', n: 3 },
  { t: T.day.saiu, kind: 'pop', n: 5 },
  // setup: the onboarding's taps, an hour on a clock, the store goes live
  { t: SCENES.setup[0], kind: 'swish' },
  ...tapsOf(SHOTS.monta).map((p) => ({ t: p.t, kind: 'tap' as const })),
  ...Array.from({ length: 12 }, (_, k) => ({ t: CLOCK[0] + (k * (CLOCK[1] - CLOCK[0])) / 12, kind: 'tick' as const, n: k })),
  { t: SHOTS.noar.from, kind: 'swish' },
  { t: T.setup.ar, kind: 'shimmer' },
  { t: T.setup.loja, kind: 'riser', dur: SCENES.price[0] - T.setup.loja },
  // price: no fee per order, then the plan's price rolls up
  { t: T.price.nenhuma, kind: 'pop', n: 1 },
  { t: T.price.taxa, kind: 'pop', n: 3 },
  { t: T.price.por, kind: 'lock' },
  { t: T.price.planos, kind: 'swish' },
  ...Array.from({ length: 8 }, (_, k) => ({ t: COUNT[0] + (k * (COUNT[1] - COUNT[0])) / 8, kind: 'tick' as const, n: k })),
  { t: COUNT[1], kind: 'chime' },
  { t: T.price.mes, kind: 'pop', n: 5 },
  // cta: the date, the trial, the link, the end card
  { t: T.cta.sabado, kind: 'lock' },
  { t: T.cta.dias, kind: 'pop', n: 4 },
  { t: T.cta.sem, kind: 'swish' },
  { t: T.cta.link, kind: 'tap' },
  { t: T.cta.end, kind: 'drop' },
  { t: T.cta.end + 0.12, kind: 'shimmer' },
];
