import { AbsoluteFill, Img, staticFile } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, prog, tw } from '../../../lib/motion';
import { rng } from '../../../lib/random';
import { Rise } from '../../../lib/text';
import { F, T } from '../timeline';
import { display, Mark, Words } from '../ui';

// "E o Duá, vendedor com IA, atende e fecha o pedido no WhatsApp." — Duá says hi, then the chat
// closes a real-menu order: cenoura com brigadeiro R$ 45,00 + entrega R$ 5,00, order #30 (the next
// after #29 on the Pedidos screen).
type Msg = { me: boolean; text: string; extra?: 'pix' | 'paid' };
// a new chat fills from the top; it scrolls only by what the last messages overflow (heights measured
// at 35 px type in the 880 × 920 card)
const HEIGHT = [116, 160, 116, 338, 224];
const ROOM = 760;
const MSGS: Msg[] = [
  { me: true, text: 'Oi! Tem bolo de cenoura?' },
  { me: false, text: 'Tem sim! Com brigadeiro, R$ 45,00. Entrega ou retirada?' },
  { me: true, text: 'Entrega!' },
  { me: false, text: 'Prontinho: R$ 50,00 com a entrega. Aqui está o Pix:', extra: 'pix' },
  { me: false, text: 'Pix recebido! Seu pedido já foi para a cozinha.', extra: 'paid' },
];

// A stand-in QR: a fixed pattern of squares, not a payable code.
const QR: React.FC = () => {
  const r = rng(30);
  const cells = Array.from({ length: 121 }, () => r() > 0.52);
  const finder = (x: number, y: number) => (x < 3 && y < 3) || (x > 7 && y < 3) || (x < 3 && y > 7);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(11, 10px)', gap: 1, padding: 8, background: '#fff', borderRadius: 10 }}>
      {cells.map((on, i) => (
        <div key={i} style={{ width: 10, height: 10, background: finder(i % 11, Math.floor(i / 11)) || on ? C.night : 'transparent', borderRadius: 2 }} />
      ))}
    </div>
  );
};

const Bubble: React.FC<{ m: Msg; p: number }> = ({ m, p }) => (
  <div style={{ maxHeight: p * 600, overflow: 'hidden', flex: 'none', display: 'flex', justifyContent: m.me ? 'flex-end' : 'flex-start', marginTop: 16 * Math.min(1, p * 2) }}>
    <div
      style={{
        maxWidth: '82%',
        padding: '20px 26px 12px',
        borderRadius: 30,
        borderTopRightRadius: m.me ? 8 : 30,
        borderTopLeftRadius: m.me ? 30 : 8,
        background: m.me ? C.bubbleMe : C.surface,
        boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
        fontFamily: FONT.body,
        fontWeight: 600,
        fontSize: 35,
        lineHeight: 1.25,
        color: '#17221d',
        transformOrigin: m.me ? '100% 0%' : '0% 0%',
        transform: `scale(${0.6 + 0.4 * ease.outBack(Math.min(1, p))})`,
        opacity: Math.min(1, p * 3),
      }}
    >
      {m.text}
      {m.extra === 'pix' && (
        <div style={{ display: 'flex', gap: 22, alignItems: 'center', marginTop: 14, padding: 14, borderRadius: 22, background: '#f1f5ef' }}>
          <QR />
          <div>
            <div style={{ fontWeight: 800, fontSize: 32 }}>Pix · R$ 50,00</div>
            <div style={{ fontSize: 26, color: '#4d6159', marginTop: 4 }}>Pedido #30</div>
            <div style={{ display: 'inline-block', marginTop: 10, padding: '8px 20px', borderRadius: 99, background: C.lime, color: C.forest, fontWeight: 800, fontSize: 25 }}>
              copiar código
            </div>
          </div>
        </div>
      )}
      {m.extra === 'paid' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, padding: '10px 18px', borderRadius: 20, background: C.forest, color: C.cream, fontWeight: 700, fontSize: 28 }}>
          <Mark size={32} /> Pedido #30 · aceito pela loja
        </div>
      )}
      <div style={{ textAlign: 'right', fontSize: 20, color: '#6d7d75', marginTop: 4 }}>18:52</div>
    </div>
  </div>
);

export const Dua: React.FC<{ t: number }> = ({ t }) => {
  const w = F.dua.w;
  const D = T.dua;
  const out = prog(t, D.chat - 0.05, 0.3, ease.inCubic);
  // the disc opens on the cut; Duá pops up inside it on his name
  const disc = prog(t, F.dua.start, 0.35, ease.outExpo);
  const pop = tw(t, D.avatar - 0.04, D.avatar + 0.4, 0, 1, ease.outBack);
  const chip = tw(t, D.chip - 0.04, D.chip + 0.3, 0, 1, ease.outBack);
  const enter = prog(t, D.chat, 0.5, ease.outExpo);
  const typing = D.msgs.some((m, i) => !MSGS[i].me && t >= m - 0.28 && t < m);
  let used = 0;
  let scroll = 0;
  HEIGHT.forEach((h, i) => {
    const over = Math.max(0, used + h - ROOM) - Math.max(0, used - ROOM);
    scroll += over * prog(t, D.msgs[i], 0.3, ease.outCubic);
    used += h;
  });

  return (
    <AbsoluteFill>
      {out < 1 && (
        <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `translateY(${-out * 160}px) scale(${1 - out * 0.08})` }}>
          <div
            style={{
              position: 'absolute',
              left: 540 - 230,
              top: 430,
              width: 460,
              height: 460,
              borderRadius: 230,
              background: C.lime,
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
              transform: `scale(${disc})`,
            }}
          >
            <Img
              src={staticFile('dua/avatar-ola.webp')}
              style={{ width: 430, height: 430, marginTop: 30, transform: `translateY(${(1 - pop) * 70}%) rotate(${(1 - Math.min(1, pop)) * -10}deg)` }}
            />
          </div>
          <div style={{ position: 'absolute', top: 950, width: '100%', textAlign: 'center', ...display(190, C.cream) }}>
            <Rise p={prog(t, w.dua - 0.05, 0.36, ease.outExpo)}>Duá</Rise>
          </div>
          <div style={{ position: 'absolute', top: 1180, width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20 }}>
            <Words t={t} words={[['vendedor', w.vendedor], ['com', w.com]]} style={{ fontFamily: FONT.body, fontWeight: 800, fontSize: 70, color: C.cream }} />
            <div
              style={{
                padding: '6px 26px 10px',
                borderRadius: 22,
                background: C.lime,
                color: C.forest,
                fontFamily: FONT.display,
                fontWeight: 700,
                fontSize: 76,
                letterSpacing: '-0.02em',
                transform: `scale(${chip})`,
              }}
            >
              IA
            </div>
          </div>
        </div>
      )}

      {enter > 0 && (
        <>
          <div style={{ position: 'absolute', left: 72, right: 72, top: 262 }}>
            <Words t={t} words={[['Atende', w.atende], ['e', w.atende + 0.38], ['fecha', w.fecha]]} style={display(90, C.cream)} />
            <Words
              t={t}
              words={[['o', w.pedido - 0.06], ['pedido', w.pedido], ['no', w.whatsapp - 0.12], ['WhatsApp.', w.whatsapp]]}
              style={{ ...display(90, C.lime), marginTop: 4 }}
            />
          </div>
          <div style={{ position: 'absolute', inset: 0, perspective: 1800, perspectiveOrigin: '540px 900px' }}>
            <div
              style={{
                position: 'absolute',
                left: 100,
                top: 500,
                width: 880,
                height: 920,
                borderRadius: 48,
                overflow: 'hidden',
                background: C.chatWall,
                boxShadow: '0 50px 120px rgba(0,0,0,0.5)',
                transformOrigin: '50% 30%',
                transform: `translateY(${(1 - enter) * 900}px) rotateX(${8 + (1 - enter) * 40}deg) rotateY(${-6 + 2 * Math.sin(t * 1.1)}deg) scale(${1 + tw(t, D.chat, F.dua.end, 0, 0.04, ease.linear)})`,
              }}
            >
              <div style={{ height: 124, background: C.forestDeep, display: 'flex', alignItems: 'center', gap: 22, padding: '0 30px' }}>
                <div style={{ fontFamily: FONT.body, fontSize: 52, color: C.cream, marginTop: -6 }}>‹</div>
                <div style={{ width: 80, height: 80, borderRadius: 40, background: C.lime, overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
                  <Img src={staticFile('dua/avatar-ola.webp')} style={{ width: 76, height: 76, marginTop: 8 }} />
                </div>
                <div style={{ fontFamily: FONT.body }}>
                  <div style={{ fontWeight: 700, fontSize: 38, color: C.cream }}>Bolos da Nena</div>
                  <div style={{ fontWeight: 600, fontSize: 27, color: typing ? C.lime : C.muted }}>{typing ? 'digitando…' : 'online'}</div>
                </div>
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 124,
                  left: 0,
                  right: 0,
                  bottom: 26,
                  padding: '8px 28px 0',
                  overflow: 'hidden',
                  WebkitMaskImage: scroll > 1 ? 'linear-gradient(to bottom, transparent 0%, #000 8%)' : 'none',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', transform: `translateY(${-scroll}px)` }}>
                  {MSGS.map((m, i) => (t >= D.msgs[i] ? <Bubble key={i} m={m} p={prog(t, D.msgs[i], 0.24, ease.outCubic)} /> : null))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </AbsoluteFill>
  );
};
