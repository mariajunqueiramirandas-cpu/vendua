import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { Phone } from '../../../lib/phone';
import { Rise, split } from '../../../lib/text';
import { counterAt, G, SCENES, T } from '../timeline';

const O = T.orders;
const END = SCENES.orders[1];

// The demo store's menu (Bolos da Nena, as on the admin captures).
const CARDS = [
  ['#24', '1× Bolo de cenoura com brigadeiro', 'R$ 45,00'],
  ['#25', '2× Bolo de milho cremoso', 'R$ 85,00'],
  ['#26', '1× Bolo de chocolate molhadinho', 'R$ 48,00'],
  ['#27', '3× Fatia de cenoura', 'R$ 28,50'],
  ['#28', '2× Bolo de milho cremoso', 'R$ 85,00'],
  ['#29', '1× Bolo de laranja com calda', 'R$ 38,00'],
  ['#30', '1× Bolo de cenoura + 1 fatia', 'R$ 54,50'],
  ['#31', '2× Bolo de chocolate molhadinho', 'R$ 96,00'],
] as const;
const WORDS = ['Agora,', 'seu', 'vendedor', 'com IA:'];

const brl = (cents: number) => `R$ ${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;

const Card: React.FC<{ t: number; i: number }> = ({ t, i }) => {
  const land = O.cards[i];
  const fly = prog(t, land - 0.2, 0.2, ease.outCubic);
  if (fly <= 0) return null;
  const newer = O.cards.filter((c, j) => j > i && t >= c).length;
  const settle = O.cards.slice(i + 1).reduce((m, c) => m + prog(t, c, 0.18, ease.outCubic), 0);
  const out = prog(t, O.counter, 0.16, ease.inCubic);
  if (newer > 4 || out >= 1) return null;
  const bump = kick(t, land, 0.25);
  const [id, item, price] = CARDS[i];
  return (
    <div
      style={{
        position: 'absolute',
        left: -6,
        top: 150,
        width: 640,
        padding: '24px 28px',
        borderRadius: 34,
        background: C.surface,
        boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        gap: 22,
        transformOrigin: '50% 0%',
        transform: `translateZ(${(1 - fly) * -1800 + 90 - settle * 20 + out * 260}px) translateY(${settle * 36 - bump * 10 - out * 160}px) scale(${1 - settle * 0.05})`,
        opacity: Math.min(1, fly * 2) * (1 - out) * (1 - Math.max(0, settle - 3)),
        filter: `brightness(${1 - Math.min(settle, 3) * 0.12})`,
      }}
    >
      <div style={{ width: 70, height: 70, borderRadius: 35, background: C.lime, display: 'grid', placeItems: 'center', flex: 'none' }}>
        <svg viewBox="0 0 128 128" width={40} height={40}>
          <path d="M32 48 L61 88 L98 34" fill="none" stroke={C.forest} strokeWidth={17} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', whiteSpace: 'nowrap', fontFamily: FONT.body, fontWeight: 800, fontSize: 34, color: C.forest }}>
          <span>Novo pedido {id}</span>
          <span>{price}</span>
        </div>
        <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 27, color: '#4d6159', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item}
        </div>
      </div>
    </div>
  );
};

export const Orders: React.FC<{ t: number }> = ({ t }) => {
  const counting = t >= O.counter;
  const enter = prog(t, O.line1, 0.75, ease.outExpo);
  const down = prog(t, O.counter, 0.45, ease.outExpo);
  const bump = O.cards.reduce((m, c) => Math.max(m, kick(t, c, 0.22)), 0);
  const dolly = prog(t, O.build, END - O.build, ease.inExpo);
  const word = O.words.reduce((k, w, i) => (t >= w ? i : k), -1);
  const ry = -14 + 6 * Math.sin(t * 1.4);
  const landed = kick(t, O.counterEnd, 0.4);

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          transformOrigin: '540px 1150px',
          transform: `scale(${1 + dolly * 4})`,
          filter: `blur(${tw(t, END - 0.4, END, 0, 14)}px)`,
        }}
      >
        {!counting ? (
          <div style={{ position: 'absolute', top: 270, left: 72, right: 72, fontFamily: FONT.display, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 0.95 }}>
            <Rise p={prog(t, O.line1, 0.35, ease.outExpo)} style={{ fontSize: 132, color: C.cream }}>
              Os pedidos
            </Rise>
            <br />
            <Rise p={prog(t, O.line2, 0.35, ease.outExpo)} style={{ fontSize: 82, color: C.lime }}>
              caem no seu celular.
            </Rise>
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 290,
              width: '100%',
              textAlign: 'center',
              transform: `scale(${(0.8 + 0.2 * prog(t, O.counter, 0.3, ease.outBack)) * (1 + landed * 0.07)})`,
            }}
          >
            <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 52, color: C.muted }}>vendas de hoje</div>
            <div
              style={{
                fontFamily: FONT.display,
                fontWeight: 700,
                fontSize: 178,
                letterSpacing: '-0.05em',
                color: C.lime,
                fontVariantNumeric: 'tabular-nums',
                textShadow: `0 0 ${60 * landed}px rgba(217,248,117,0.8)`,
              }}
            >
              {brl(counterAt(t))}
            </div>
          </div>
        )}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, perspective: 2200, perspectiveOrigin: '540px 900px' }}>
          <div
            style={{
              position: 'absolute',
              left: 540 - 300,
              top: 1210 - 650,
              width: 600,
              height: 1300,
              transformStyle: 'preserve-3d',
              transform: `translateY(${(1 - enter) * 1100 + down * 210 - bump * 14}px) rotateX(${14 + (1 - enter) * 45}deg) rotateY(${ry}deg) rotateZ(${(1 - enter) * -10}deg) scale(${1 - down * 0.1})`,
            }}
          >
            <Phone src={counting ? 'screens/inicio-noite-750.webp' : 'screens/pedidos-noite-750.webp'} width={566} glare={ry / 20}>
              {CARDS.map((_, i) => (
                <Card key={i} t={t} i={i} />
              ))}
            </Phone>
          </div>
        </div>
      </AbsoluteFill>
      {word >= 0 && (
        <AbsoluteFill style={{ background: `rgba(10,16,13,${0.5 + tw(t, END - G.beat / 2, END, 0, 0.45)})`, display: 'grid', placeItems: 'center' }}>
          <div
            style={{
              fontFamily: FONT.display,
              fontWeight: 700,
              fontSize: [130, 170, 190, 210][word],
              letterSpacing: '-0.05em',
              color: word === 3 ? C.lime : C.cream,
              transform: `scale(${1.5 - 0.5 * prog(t, O.words[word], 0.2, ease.outExpo)})`,
              textShadow: split(kick(t, O.words[word], 0.3), 14),
            }}
          >
            {WORDS[word]}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
