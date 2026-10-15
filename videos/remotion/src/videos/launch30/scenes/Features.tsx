import { AbsoluteFill, Img, staticFile } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { FEATURE, FEATURE_BEATS, FEATURE_IDS, type FeatureId } from '../timeline';
import { Words, fadeOut, reveal } from '../ui';

// Four shots, one bar (2.5 s) each: a headline, and one object drawn in code doing its one thing.
const HEAD: Record<FeatureId, [string, string]> = {
  pedido: ['Cada pedido,', 'direto no seu celular.'],
  pix: ['Pix na hora,', 'no mesmo pedido.'],
  cardapio: ['Cardápio e horários', 'num toque.'],
  dua: ['E o Duá: seu vendedor', 'com IA no WhatsApp.'],
};
const ink = '#17221d';
const soft = '#5b6b63';

const Check: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg viewBox="0 0 128 128" width={size} height={size} style={{ display: 'block' }}>
    <path d="M32 48 L61 88 L98 34" fill="none" stroke={color} strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const card: React.CSSProperties = {
  borderRadius: 44,
  background: C.surface,
  boxShadow: '0 50px 120px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
  fontFamily: FONT.body,
  color: ink,
};

const Pedido: React.FC<{ t: number; at: number[] }> = ({ t, at }) => {
  const p = prog(t, at[0], 0.9, ease.outQuart);
  return (
    <div style={{ ...card, width: 860, padding: '34px 38px', opacity: t < at[0] ? 0 : Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * -90}px) scale(${0.96 + 0.04 * p})`, background: 'rgba(247,244,234,0.96)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: C.forest, display: 'grid', placeItems: 'center' }}>
          <Img src={staticFile('brand/mark-lime.svg')} style={{ width: 46, height: 46 }} />
        </div>
        <div style={{ flex: 1, fontWeight: 700, fontSize: 28, letterSpacing: '0.08em', color: soft }}>MINHA LOJA</div>
        <div style={{ fontWeight: 600, fontSize: 28, color: soft }}>agora</div>
      </div>
      <div style={{ fontWeight: 800, fontSize: 50, marginTop: 20 }}>Pedido #29 chegou</div>
      <div style={{ fontWeight: 600, fontSize: 40, color: soft, marginTop: 6 }}>Luiz · R$ 219,00 · entrega</div>
    </div>
  );
};

const Pix: React.FC<{ t: number; at: number[] }> = ({ t, at }) => {
  const paid = t >= at[0];
  const c = tw(t, at[0], at[0] + 0.5, 0, 1, ease.outBack);
  return (
    <div style={{ ...card, width: 860, padding: '44px 48px', display: 'flex', alignItems: 'center', gap: 40 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 34, color: soft }}>Pedido #29 · Luiz</div>
        <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 110, letterSpacing: '-0.045em', lineHeight: 1.05, marginTop: 8 }}>R$ 219,00</div>
        <div style={{ display: 'inline-block', marginTop: 16, padding: '10px 26px', borderRadius: 99, background: paid ? C.forest : 'rgba(18,60,50,0.08)', color: paid ? C.lime : soft, fontWeight: 800, fontSize: 32 }}>
          {paid ? 'Pix recebido' : 'Aguardando Pix'}
        </div>
      </div>
      <div style={{ width: 180, height: 180, borderRadius: 90, border: `5px solid ${paid ? C.lime : 'rgba(18,60,50,0.15)'}`, display: 'grid', placeItems: 'center', background: paid ? C.lime : 'transparent', boxShadow: paid ? `0 0 ${50 * kick(t, at[0], 1.2)}px ${C.lime}` : 'none' }}>
        <div style={{ transform: `scale(${c})` }}>
          <Check size={120} color={C.forest} />
        </div>
      </div>
    </div>
  );
};

const Toggle: React.FC<{ on: number }> = ({ on }) => (
  <div style={{ position: 'relative', flex: 'none', width: 128, height: 72, borderRadius: 36, background: on > 0.5 ? C.lime : '#d9d6cc' }}>
    <div style={{ position: 'absolute', top: 7, left: 7 + on * 56, width: 58, height: 58, borderRadius: 29, background: on > 0.5 ? C.forest : '#fff', boxShadow: '0 3px 8px rgba(0,0,0,0.2)' }} />
  </div>
);
const Cardapio: React.FC<{ t: number; at: number[] }> = ({ t, at }) => (
  <div style={{ ...card, width: 860, padding: '18px 0' }}>
    {[
      ['Loja aberta', 'Hoje, das 9h às 19h'],
      ['Fatia de cenoura c/ brigadeiro', 'No cardápio'],
    ].map(([a, b], k) => (
      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '28px 44px', borderTop: k ? '2px solid rgba(18,60,50,0.08)' : 'none' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 42 }}>{a}</div>
          <div style={{ fontWeight: 600, fontSize: 32, color: soft, marginTop: 4 }}>{b}</div>
        </div>
        <Toggle on={prog(t, at[k], 0.25, ease.inOutCubic)} />
      </div>
    ))}
  </div>
);

const Bubble: React.FC<{ me: boolean; text: string; t: number; s: number }> = ({ me, text, t, s }) => (
  <div style={{ display: 'flex', justifyContent: me ? 'flex-end' : 'flex-start', marginTop: 22, ...reveal(t, s, 0.7, 24) }}>
    <div style={{ maxWidth: 640, padding: '24px 32px', borderRadius: 34, borderBottomRightRadius: me ? 10 : 34, borderBottomLeftRadius: me ? 34 : 10, background: me ? C.bubbleMe : C.surface, fontFamily: FONT.body, fontWeight: 600, fontSize: 40, lineHeight: 1.25, color: ink, boxShadow: '0 20px 50px rgba(0,0,0,0.35)' }}>
      {!me && <div style={{ fontWeight: 800, fontSize: 30, color: '#2f7a5c', marginBottom: 4 }}>Duá · Bolos da Nena</div>}
      {text}
    </div>
  </div>
);
const Dua: React.FC<{ t: number; at: number[] }> = ({ t, at }) => (
  <div style={{ width: 860 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
      <div style={{ width: 150, height: 150, borderRadius: 75, background: C.forest, display: 'grid', placeItems: 'center', boxShadow: '0 0 0 6px rgba(217,248,117,0.25)' }}>
        <Img src={staticFile('dua/avatar-feliz.webp')} style={{ width: 136, height: 136 }} />
      </div>
      <div style={{ fontFamily: FONT.body }}>
        <div style={{ fontWeight: 800, fontSize: 44, color: C.cream }}>Duá</div>
        <div style={{ fontWeight: 600, fontSize: 32, color: C.lime }}>online no WhatsApp da loja</div>
      </div>
    </div>
    <Bubble me t={t} s={at[0]} text="Tem bolo de cenoura hoje?" />
    <Bubble me={false} t={t} s={at[1]} text="Tem sim! Com brigadeiro. Entrega ou retirada?" />
  </div>
);

const OBJECT: Record<FeatureId, React.FC<{ t: number; at: number[] }>> = { pedido: Pedido, pix: Pix, cardapio: Cardapio, dua: Dua };

export const Features: React.FC<{ t: number }> = ({ t }) => (
  <AbsoluteFill>
    {FEATURE_IDS.map((id, i) => {
      const f = FEATURE(i);
      if (t < f.start - 0.05 || t > f.end + 0.2) return null;
      const at = FEATURE_BEATS[id].map(f.at);
      const O = OBJECT[id];
      const [a, b] = HEAD[id];
      const drift = tw(t, f.start, f.end + 0.2, 0, -26, ease.linear);
      return (
        <AbsoluteFill key={id} style={{ opacity: fadeOut(t, f.end) }}>
          <div style={{ position: 'absolute', left: 96, right: 96, top: 420, fontFamily: FONT.display, fontWeight: 600, fontSize: 78, letterSpacing: '-0.035em', lineHeight: 1.08 }}>
            <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 28, letterSpacing: '0.24em', color: C.lime, marginBottom: 26, ...reveal(t, f.start, 0.8, 16) }}>0{i + 1}</div>
            <div style={{ color: C.cream }}>
              <Words t={t} start={f.start + 0.05} text={a} />
            </div>
            <div style={{ color: C.muted }}>
              <Words t={t} start={f.start + 0.25} text={b} />
            </div>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 820, display: 'flex', justifyContent: 'center', transform: `translateY(${drift}px)` }}>
            <div style={id === 'pedido' ? {} : reveal(t, f.start + 0.3, 1.1, 60)}>
              <O t={t} at={at} />
            </div>
          </div>
        </AbsoluteFill>
      );
    })}
  </AbsoluteFill>
);
