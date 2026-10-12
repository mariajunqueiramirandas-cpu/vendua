import { AbsoluteFill, Img, staticFile } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { rng } from '../../../lib/random';
import { Rise } from '../../../lib/text';
import { CHECK, CHECK_BEATS, CHECK_IDS, G, SALES_AFTER, SALES_BEFORE, SCENES, type CheckId } from '../timeline';

// Five systems, one bar each. Every one is the product drawn in code (no captures): the card flies
// in on the downbeat, does its one thing on the beat, gets stamped "pronto" and whips out.
const COPY: Record<CheckId, [string, string]> = {
  loja: ['Loja online', 'com a sua cara.'],
  pedido: ['Pedidos', 'caem direto no seu celular.'],
  pix: ['Pix na hora', 'e o total do dia na tela.'],
  cozinha: ['Cozinha', 'o pedido já sai impresso.'],
  cardapio: ['Cardápio e horários', 'você liga e pausa num toque.'],
};

const ink = '#17221d';
const soft = '#5b6b63';

export const Check: React.FC<{ size: number; color: string; stroke?: number }> = ({ size, color, stroke = 17 }) => (
  <svg viewBox="0 0 128 128" width={size} height={size} style={{ display: 'block' }}>
    <path d="M32 48 L61 88 L98 34" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const money = (cents: number) => `R$ ${Math.floor(cents / 100).toLocaleString('pt-BR')},${String(cents % 100).padStart(2, '0')}`;

/** The beat times of check `i`'s own moments, and a 0…1 pop for each. */
const moments = (t: number, i: number) => {
  const c = CHECK(i);
  const at = CHECK_BEATS[CHECK_IDS[i]].map(c.at);
  return { at, p: at.map((s) => prog(t, s, 0.3, ease.outBack)), on: at.map((s) => t >= s) };
};

// ── 1. the store ──
const FOOD: [string, string, string][] = [
  ['Fatia de cenoura c/ brigadeiro', '#f0a24a', '#5a2f1c'],
  ['Bolo de chocolate', '#7a4328', '#3a1c10'],
  ['Bolo de fubá', '#f3cf6b', '#c9892d'],
  ['Brownie', '#8a5a3c', '#2e170c'],
];
const Loja: React.FC<{ t: number; i: number }> = ({ t, i }) => {
  const { at, on } = moments(t, i);
  const s = CHECK(i).start;
  const bag = on.filter(Boolean).length;
  const bump = at.reduce((m, a) => Math.max(m, kick(t, a, 0.25)), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ background: C.forest, padding: '32px 44px', display: 'flex', alignItems: 'center', gap: 26 }}>
        <div style={{ width: 96, height: 96, borderRadius: 48, background: C.lime, display: 'grid', placeItems: 'center', fontFamily: FONT.display, fontWeight: 700, fontSize: 54, color: C.forest }}>N</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 50, letterSpacing: '-0.03em', color: C.cream }}>Bolos da Nena</div>
          <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 30, color: C.muted, marginTop: 2 }}>Bolo de vó, feito hoje.</div>
        </div>
        <div style={{ padding: '8px 20px', borderRadius: 99, background: 'rgba(217,248,117,0.16)', color: C.lime, fontFamily: FONT.body, fontWeight: 800, fontSize: 26 }}>aberta</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, padding: 30 }}>
        {FOOD.map(([name, c0, c1], k) => {
          const enter = prog(t, s + 0.08 + k * 0.05, 0.35, ease.outBack);
          const press = kick(t, at[k], 0.3);
          return (
            <div key={k} style={{ position: 'relative', borderRadius: 30, background: '#f3efe3', padding: 20, transform: `scale(${(0.6 + 0.4 * enter) * (1 - press * 0.05)})`, opacity: Math.min(1, enter * 2) }}>
              <div style={{ height: 96, borderRadius: 22, background: `radial-gradient(circle at 38% 32%, ${c0} 0%, ${c0} 30%, ${c1} 75%)`, boxShadow: 'inset 0 -12px 0 rgba(0,0,0,0.12)' }} />
              <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 28, lineHeight: 1.15, color: ink, marginTop: 12, paddingRight: 70, height: 66 }}>{name}</div>
              <div
                style={{
                  position: 'absolute',
                  right: 18,
                  bottom: 18,
                  width: 62,
                  height: 62,
                  borderRadius: 31,
                  display: 'grid',
                  placeItems: 'center',
                  background: on[k] ? C.lime : C.forest,
                  color: on[k] ? C.forest : C.cream,
                  fontFamily: FONT.display,
                  fontWeight: 700,
                  fontSize: 46,
                  transform: `scale(${1 + press * 0.4})`,
                  boxShadow: press > 0.05 ? `0 0 0 ${press * 26}px rgba(217,248,117,${press * 0.5})` : 'none',
                }}
              >
                {on[k] ? <Check size={34} color={C.forest} stroke={22} /> : '+'}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ margin: '0 30px 24px', padding: '20px 34px', borderRadius: 99, background: C.forest, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: FONT.body, fontWeight: 800, fontSize: 36, color: C.cream }}>
        <span>Ver sacola</span>
        <span style={{ display: 'inline-grid', placeItems: 'center', minWidth: 64, height: 64, borderRadius: 32, background: C.lime, color: C.forest, transform: `scale(${1 + bump * 0.35})` }}>{bag}</span>
      </div>
    </div>
  );
};

// ── 2. the order lands on the shop's phone ──
const Push: React.FC<{ n: number; who: string; total: string; p: number; action?: number; tapped?: boolean }> = ({ n, who, total, p, action, tapped }) => (
  <div
    style={{
      borderRadius: 34,
      background: 'rgba(247,244,234,0.94)',
      padding: '24px 26px',
      boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
      transform: `translateY(${(1 - p) * -160}px) scale(${0.9 + 0.1 * p})`,
      opacity: Math.min(1, p * 2.5),
      marginBottom: 18,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 54, height: 54, borderRadius: 14, background: C.forest, display: 'grid', placeItems: 'center' }}>
        <Img src={staticFile('brand/mark-lime.svg')} style={{ width: 40, height: 40 }} />
      </div>
      <div style={{ flex: 1, fontFamily: FONT.body, fontWeight: 700, fontSize: 24, letterSpacing: '0.06em', color: soft }}>MINHA LOJA</div>
      <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 24, color: soft }}>agora</div>
    </div>
    <div style={{ fontFamily: FONT.body, fontWeight: 800, fontSize: 40, color: ink, marginTop: 14 }}>Pedido #{n} chegou</div>
    <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 32, color: soft, marginTop: 4 }}>
      {who} · {total} · entrega
    </div>
    {action !== undefined && (
      <div style={{ position: 'relative', marginTop: 18, height: 74, borderRadius: 22, overflow: 'hidden', background: tapped ? C.lime : 'rgba(18,60,50,0.1)', display: 'grid', placeItems: 'center' }}>
        {action > 0 && action < 1 && (
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: 900, height: 900, marginLeft: -450, marginTop: -450, borderRadius: 450, background: 'rgba(18,60,50,0.25)', transform: `scale(${action})`, opacity: 1 - action }} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: FONT.body, fontWeight: 800, fontSize: 34, color: C.forest }}>
          {tapped ? (
            <>
              <Check size={36} color={C.forest} stroke={22} /> aceito
            </>
          ) : (
            'aceitar'
          )}
        </div>
      </div>
    )}
  </div>
);
const Pedido: React.FC<{ t: number; i: number }> = ({ t, i }) => {
  const { at, p, on } = moments(t, i);
  const tap = t >= at[2] ? prog(t, at[2], 0.4, ease.outCubic) : 0;
  // the finger: a soft disc that lands on "aceitar"
  const finger = tw(t, at[2] - 0.25, at[2], 0, 1, ease.outCubic) * (1 - tw(t, at[2] + 0.15, at[2] + 0.4, 0, 1));
  return (
    <div style={{ position: 'relative', height: '100%', background: `linear-gradient(170deg, ${C.forest} 0%, ${C.forestDeep} 55%, ${C.night} 100%)`, padding: '44px 36px', fontFamily: FONT.body }}>
      <div style={{ textAlign: 'center', color: C.cream }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 500, fontSize: 150, letterSpacing: '-0.04em', lineHeight: 1 }}>18:04</div>
        <div style={{ fontWeight: 600, fontSize: 34, color: C.muted, marginTop: 6 }}>sexta-feira, 16 de outubro</div>
      </div>
      <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column-reverse' }}>
        {on[0] && <Push n={28} who="Mariana" total="R$ 85,00" p={p[0]} />}
        {on[1] && <Push n={29} who="Luiz" total="R$ 219,00" p={p[1]} action={tap} tapped={t >= at[2]} />}
      </div>
      {finger > 0.01 && (
        <div style={{ position: 'absolute', left: 420, top: 455, width: 110, height: 110, borderRadius: 55, background: 'rgba(247,244,234,0.55)', border: '4px solid rgba(255,255,255,0.8)', transform: `scale(${1.4 - 0.4 * finger})`, opacity: finger }} />
      )}
    </div>
  );
};

// ── 3. Pix ──
// A stand-in QR: a fixed pattern of squares, not a payable code.
const QR: React.FC<{ size: number }> = ({ size }) => {
  const r = rng(29);
  const N = 21;
  const cell = size / N;
  const finder = (x: number, y: number) => {
    const f = (a: number, b: number) => x >= a && x < a + 7 && y >= b && y < b + 7 && (x === a || x === a + 6 || y === b || y === b + 6 || (x >= a + 2 && x <= a + 4 && y >= b + 2 && y <= b + 4));
    const zone = (a: number, b: number) => x >= a - 1 && x < a + 8 && y >= b - 1 && y < b + 8;
    return { on: f(0, 0) || f(N - 7, 0) || f(0, N - 7), zone: zone(0, 0) || zone(N - 7, 0) || zone(0, N - 7) };
  };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      {Array.from({ length: N * N }, (_, k) => {
        const x = k % N;
        const y = Math.floor(k / N);
        const f = finder(x, y);
        const v = r() > 0.5;
        return f.on || (!f.zone && v) ? <rect key={k} x={x * cell} y={y * cell} width={cell + 0.5} height={cell + 0.5} fill={C.night} /> : null;
      })}
    </svg>
  );
};
const outCubic = (x: number) => 1 - (1 - x) ** 3;
const Pix: React.FC<{ t: number; i: number }> = ({ t, i }) => {
  const { at, p } = moments(t, i);
  const paid = t >= at[1];
  const flip = tw(t, at[1] - 0.12, at[1] + 0.1, 0, 180, ease.inOutCubic);
  const x = Math.min(1, Math.max(0, (t - at[1]) / (at[2] - at[1])));
  const sales = SALES_BEFORE + Math.round((outCubic(x) * (SALES_AFTER - SALES_BEFORE)) / 100) * 100;
  const land = kick(t, at[2], 0.4);
  return (
    <div style={{ height: '100%', padding: '44px 48px', fontFamily: FONT.body, color: ink, display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontWeight: 700, fontSize: 32, color: soft }}>Pedido #29 · Luiz</div>
      <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 116, letterSpacing: '-0.05em', lineHeight: 1, marginTop: 6 }}>R$ 219,00</div>
      <div style={{ display: 'flex', gap: 34, alignItems: 'center', marginTop: 34 }}>
        <div style={{ perspective: 900 }}>
          <div style={{ position: 'relative', width: 270, height: 270, transformStyle: 'preserve-3d', transform: `rotateY(${flip}deg) scale(${0.7 + 0.3 * p[0]})`, opacity: Math.min(1, p[0] * 2) }}>
            <div style={{ position: 'absolute', inset: 0, background: '#fff', borderRadius: 26, padding: 18, backfaceVisibility: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.12)' }}>
              <QR size={234} />
            </div>
            <div style={{ position: 'absolute', inset: 0, borderRadius: 135, background: C.lime, display: 'grid', placeItems: 'center', backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', boxShadow: `0 0 ${60 * kick(t, at[1], 0.6)}px ${C.lime}` }}>
              <Check size={190} color={C.forest} stroke={20} />
            </div>
          </div>
        </div>
        <div>
          <div style={{ display: 'inline-block', padding: '8px 22px', borderRadius: 99, background: paid ? C.forest : 'rgba(18,60,50,0.1)', color: paid ? C.lime : C.forest, fontWeight: 800, fontSize: 30 }}>
            {paid ? 'Pix recebido' : 'Pix · copia e cola'}
          </div>
          <div style={{ fontWeight: 700, fontSize: 36, marginTop: 16, lineHeight: 1.2 }}>{paid ? 'Pago agora.' : 'Aguardando…'}</div>
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ borderTop: '3px dashed rgba(18,60,50,0.2)', paddingTop: 28, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700, fontSize: 34, color: soft }}>Vendas hoje</div>
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 84, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums', color: paid ? C.forest : ink, transform: `scale(${1 + land * 0.08})`, transformOrigin: '100% 100%' }}>
          {money(sales)}
        </div>
      </div>
    </div>
  );
};

// ── 4. the kitchen printer ──
const LINES: [string, string?][] = [
  ['PEDIDO #29'],
  ['Luiz · entrega'],
  ['—'],
  ['2× Fatia de cenoura', 'c/ brigadeiro'],
  ['1× Bolo de chocolate'],
  ['1× Brownie'],
  ['—'],
  ['TOTAL  R$ 219,00'],
];
const Cozinha: React.FC<{ t: number; i: number }> = ({ t, i }) => {
  const { at } = moments(t, i);
  const printing = t >= at[0] && t < at[1];
  // paper feeds in steps on the 32nds, like a thermal head
  const steps = Math.floor(Math.max(0, Math.min(t, at[1]) - at[0]) / (G.beat / 8));
  const total = Math.round((at[1] - at[0]) / (G.beat / 8));
  const feed = Math.min(1, steps / total);
  const torn = t >= at[1];
  const tear = prog(t, at[1], 0.35, ease.outBack);
  const chip = prog(t, at[1] + 0.05, 0.3, ease.outBack);
  const paperH = 560;
  return (
    <div style={{ position: 'relative', height: '100%', padding: '40px 44px', fontFamily: FONT.body }}>
      <div style={{ position: 'relative', zIndex: 2, height: 120, borderRadius: 30, background: `linear-gradient(180deg, #2b3430, ${C.night})`, boxShadow: '0 14px 30px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', padding: '0 34px', gap: 18 }}>
        <div style={{ width: 18, height: 18, borderRadius: 9, background: printing ? C.lime : '#3d4a44', boxShadow: printing ? `0 0 18px ${C.lime}` : 'none' }} />
        <div style={{ fontWeight: 700, fontSize: 30, color: C.muted, flex: 1 }}>Impressora · cozinha</div>
        <div style={{ position: 'absolute', left: 110, right: 110, bottom: 18, height: 8, borderRadius: 4, background: '#000' }} />
      </div>
      <div style={{ position: 'absolute', left: 150, right: 150, top: 140, height: paperH, overflow: 'hidden', zIndex: 1 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: paperH,
            transform: `translateY(${-(1 - feed) * paperH + (torn ? tear * 18 : 0)}px) rotate(${torn ? tear * 2.5 : 0}deg)`,
            background: '#fffefb',
            padding: '30px 34px',
            boxShadow: '0 12px 24px rgba(0,0,0,0.12)',
            clipPath: 'polygon(0 0, 100% 0, 100% 97%, 95% 100%, 90% 97%, 85% 100%, 80% 97%, 75% 100%, 70% 97%, 65% 100%, 60% 97%, 55% 100%, 50% 97%, 45% 100%, 40% 97%, 35% 100%, 30% 97%, 25% 100%, 20% 97%, 15% 100%, 10% 97%, 5% 100%, 0 97%)',
            fontFamily: FONT.display,
            fontVariantNumeric: 'tabular-nums',
            color: ink,
          }}
        >
          {LINES.map(([a, b], k) =>
            a === '—' ? (
              <div key={k} style={{ borderTop: '3px dashed rgba(23,34,29,0.35)', margin: '16px 0' }} />
            ) : (
              <div key={k} style={{ fontWeight: k === 0 || k === LINES.length - 1 ? 700 : 500, fontSize: k === 0 ? 44 : 30, lineHeight: 1.3, marginTop: k === 1 ? 2 : 6 }}>
                {a}
                {b && <div style={{ paddingLeft: 38 }}>{b}</div>}
              </div>
            ),
          )}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 44,
          right: 44,
          bottom: 40,
          zIndex: 3,
          padding: '22px 30px',
          borderRadius: 26,
          background: C.forest,
          color: C.cream,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          fontWeight: 800,
          fontSize: 34,
          transform: `translateY(${(1 - chip) * 60}px) scale(${0.8 + 0.2 * chip})`,
          opacity: Math.min(1, chip * 2),
        }}
      >
        <span style={{ width: 22, height: 22, borderRadius: 11, background: C.lime }} />
        Na cozinha · preparando
      </div>
    </div>
  );
};

// ── 5. menu and hours ──
const ROWS: [string, string][] = [
  ['Loja aberta', 'Hoje, das 9h às 19h'],
  ['Fatia de cenoura c/ brigadeiro', 'No cardápio'],
  ['Entrega', 'Bairros cadastrados'],
  ['Retirada', 'No balcão'],
];
const Toggle: React.FC<{ p: number }> = ({ p }) => (
  <div style={{ position: 'relative', flex: 'none', width: 120, height: 68, borderRadius: 34, background: p > 0.5 ? C.lime : '#d9d6cc', transition: 'none' }}>
    <div style={{ position: 'absolute', top: 6, left: 6 + p * 52, width: 56, height: 56, borderRadius: 28, background: p > 0.5 ? C.forest : '#fff', boxShadow: '0 3px 8px rgba(0,0,0,0.2)' }} />
  </div>
);
const Cardapio: React.FC<{ t: number; i: number }> = ({ t, i }) => {
  const { at } = moments(t, i);
  return (
    <div style={{ height: '100%', padding: '40px 44px', fontFamily: FONT.body, color: ink }}>
      <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 30, letterSpacing: '0.16em', color: soft }}>MINHA LOJA · AJUSTES</div>
      {ROWS.map(([a, b], k) => {
        const p = prog(t, at[k] - 0.02, 0.16, ease.outCubic);
        const flash = kick(t, at[k], 0.35);
        return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 26, padding: '26px 30px', borderRadius: 30, background: `rgba(217,248,117,${0.1 + flash * 0.5})`, border: '3px solid rgba(18,60,50,0.08)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 38, lineHeight: 1.15 }}>{a}</div>
              <div style={{ fontWeight: 600, fontSize: 28, color: soft, marginTop: 4 }}>{b}</div>
            </div>
            <Toggle p={p} />
          </div>
        );
      })}
    </div>
  );
};

const VIGNETTE: Record<CheckId, React.FC<{ t: number; i: number }>> = { loja: Loja, pedido: Pedido, pix: Pix, cozinha: Cozinha, cardapio: Cardapio };

export const Checks: React.FC<{ t: number }> = ({ t }) => {
  const i = Math.min(CHECK_IDS.length - 1, Math.floor((t - SCENES.checks[0]) / G.bar + 1e-6));
  const id = CHECK_IDS[i];
  const c = CHECK(i);
  const last = i === CHECK_IDS.length - 1;
  const enter = prog(t, c.start, 0.38, ease.outExpo);
  // the last check doesn't whip out: Duá's boot takes over the frame on the next downbeat
  const exit = last ? 0 : prog(t, c.exit, c.end - c.exit, ease.inExpo);
  const stamp = prog(t, c.ok, 0.22, ease.outExpo);
  const thud = kick(t, c.ok, 0.3);
  const V = VIGNETTE[id];
  const [title, sub] = COPY[id];

  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 84, right: 84, top: 360, transform: `translateX(${-exit * 500}px)`, opacity: 1 - exit, filter: exit > 0 ? `blur(${exit * 12}px)` : 'none' }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 30, letterSpacing: '0.22em', color: C.lime }}>
          <Rise p={prog(t, c.start, 0.3, ease.outExpo)}>SISTEMA 0{i + 1}</Rise>
        </div>
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: title.length > 12 ? 92 : 120, letterSpacing: '-0.05em', lineHeight: 1, color: C.cream, marginTop: 10 }}>
          <Rise p={prog(t, c.start + 0.03, 0.35, ease.outExpo)}>{title}</Rise>
        </div>
        <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 44, color: C.muted, marginTop: 10 }}>
          <Rise p={prog(t, c.start + 0.12, 0.35, ease.outExpo)}>{sub}</Rise>
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, perspective: 1800, perspectiveOrigin: '540px 1000px' }}>
        <div
          style={{
            position: 'absolute',
            left: 130,
            top: 640,
            width: 820,
            height: 820,
            borderRadius: 56,
            overflow: 'hidden',
            background: C.surface,
            boxShadow: `0 60px 140px rgba(0,0,0,0.55), 0 0 0 ${thud * 10}px rgba(217,248,117,${thud * 0.6})`,
            transformOrigin: '50% 50%',
            transform: `translateX(${(1 - enter) * 1000 - exit * 1100}px) rotateY(${-9 + 3 * Math.sin(t * 1.3) - (1 - enter) * 55 + exit * 60}deg) rotateX(${6 + 2 * Math.sin(t * 0.9)}deg) rotateZ(${(1 - enter) * 6}deg) scale(${1 + thud * 0.025})`,
            filter: exit > 0 ? `blur(${exit * 10}px)` : 'none',
          }}
        >
          <V t={t} i={i} />
        </div>
        {t >= c.ok && (
          <div
            style={{
              position: 'absolute',
              right: 70,
              top: 600,
              padding: '16px 34px 18px 26px',
              borderRadius: 99,
              background: C.lime,
              color: C.forest,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontFamily: FONT.display,
              fontWeight: 700,
              fontSize: 54,
              letterSpacing: '0.04em',
              boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
              transform: `translateX(${-exit * 1100}px) rotate(${-7 + (1 - stamp) * -10}deg) scale(${2.2 - 1.2 * stamp})`,
              opacity: Math.min(1, stamp * 3) * (1 - exit),
            }}
          >
            <Check size={56} color={C.forest} stroke={22} />
            PRONTO
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
