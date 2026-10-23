import { AbsoluteFill, Img, staticFile } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { rng } from '../../../lib/random';
import { Rise, split } from '../../../lib/text';
import { display, slam } from '../kit';
import { CHAT, G, SCENES, T } from '../timeline';

const D = T.dua;
const START = SCENES.dua[0];
const END = SCENES.dua[1];
const REVEAL = [D.dua, D.tira - 0.12] as const;

// The chat as the shopper sees it on the store's WhatsApp. Duá's lines are the Vendedor's own
// formats (packages/core/src/vendedor/cards.ts): the order summary and the Pix in two messages.
const PIX = '00020126580014br.gov.bcb.pix01367d3f2a9e-41c6-4b8e-9a05-c2e81f64b7d1520400005303986540590.005802BR5913BOLOS DA NENA6006CAMPOS62070503***6304B183';
const TEXTS = [
  'Oi! Tem bolo de cenoura pra hoje?',
  'Tem sim! O de cenoura com brigadeiro sai R$ 45,00. Quantos você quer?',
  '2, pra retirar',
  '🧾 *Seu pedido* · calculado pela loja\n2× Bolo de cenoura com brigadeiro — R$ 90,00\nSubtotal — R$ 90,00\n*Total — R$ 90,00*\nRetirada na loja\nPagamento: Pix\nEstá tudo certo? Responda *sim* para confirmar.',
  'sim',
  '💠 Pix do pedido #45 · R$ 90,00 · válido até 17:21\nCopie o código abaixo e cole no app do seu banco, em Pix copia e cola.',
  PIX,
];

/** WhatsApp's *bold*, line by line */
const Rich: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split('\n').map((line, i) => (
      <div key={i}>{line.split(/(\*[^*]+\*)/).map((part, j) => (part.startsWith('*') ? <b key={j}>{part.slice(1, -1)}</b> : part))}</div>
    ))}
  </>
);

const Bubble: React.FC<{ i: number; p: number }> = ({ i, p }) => {
  const me = CHAT[i].me;
  const code = TEXTS[i] === PIX;
  return (
    <div style={{ maxHeight: p * 900, flex: 'none', display: 'flex', justifyContent: me ? 'flex-end' : 'flex-start', marginTop: 14 * Math.min(1, p * 2) }}>
      <div
        style={{
          maxWidth: '84%',
          padding: '16px 24px 10px',
          borderRadius: 26,
          borderTopRightRadius: me ? 6 : 26,
          borderTopLeftRadius: me ? 26 : 6,
          background: me ? C.bubbleMe : C.surface,
          boxShadow: '0 2px 0 rgba(0,0,0,0.06)',
          fontFamily: code ? 'ui-monospace, monospace' : FONT.body,
          fontWeight: code ? 500 : 600,
          fontSize: code ? 26 : 34,
          lineHeight: 1.3,
          wordBreak: code ? 'break-all' : 'normal',
          color: '#17221d',
          transformOrigin: me ? '100% 0%' : '0% 0%',
          transform: `scale(${0.6 + 0.4 * ease.outBack(Math.min(1, p))})`,
          opacity: Math.min(1, p * 3),
        }}
      >
        <Rich text={TEXTS[i]} />
        <div style={{ textAlign: 'right', fontFamily: FONT.body, fontSize: 19, color: '#6d7d75', marginTop: 2 }}>16:51</div>
      </div>
    </div>
  );
};

// Duá himself, between the question and the answers: a glitch-in, his name and what he is.
const Reveal: React.FC<{ t: number }> = ({ t }) => {
  const [a, b] = REVEAL;
  if (t < a - 0.05 || t > b) return null;
  const pop = tw(t, a, a + 0.45, 0, 1, ease.outBack);
  const out = prog(t, b - 0.22, 0.22, ease.inCubic);
  const g = kick(t, a, 0.45);
  const fr = rng(Math.floor(t * G.fps) + 3);
  const band = () => {
    const y = Math.floor(fr() * 80);
    return `inset(${y}% 0 ${Math.max(0, 100 - y - 8 - fr() * 18)}% 0)`;
  };
  const avatar = (dx: number, tint: string, clip: string) => (
    <div
      style={{
        position: 'absolute',
        left: 290 + dx,
        top: 420,
        width: 500,
        height: 500,
        borderRadius: 250,
        background: tint,
        clipPath: clip,
        transform: `scale(${pop}) rotate(${(1 - pop) * -14}deg)`,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <Img src={staticFile('dua/avatar-ola.webp')} style={{ width: 440, height: 440 }} />
    </div>
  );
  return (
    <AbsoluteFill style={{ transform: `scale(${1 - out * 0.3})`, opacity: 1 - out, filter: out ? `blur(${out * 12}px)` : 'none' }}>
      {avatar(0, C.lime, 'none')}
      {g > 0.05 && avatar(26 * g * (fr() - 0.5) * 2 + 18 * g, C.cream, band())}
      {g > 0.05 && avatar(-22 * g, '#5fe0c8', band())}
      <div style={{ position: 'absolute', top: 980, width: '100%', textAlign: 'center' }}>
        <div style={{ ...display(230, C.cream), textShadow: split(kick(t, a, 0.4), 14), ...slam(t, a, 1.5) }}>Duá</div>
        <div style={{ ...display(84, C.cream), marginTop: 26, lineHeight: 1.05 }}>
          <Rise p={prog(t, D.vendedor, 0.3, ease.outExpo)}>
            vendedor com <span style={{ color: C.lime, textShadow: `0 0 ${50 * kick(t, D.ia, 0.6)}px rgba(217,248,117,0.9)` }}>IA</span>
          </Rise>
        </div>
        <div
          style={{
            display: 'inline-block',
            marginTop: 40,
            padding: '14px 34px 18px',
            borderRadius: 99,
            background: C.lime,
            color: C.forest,
            fontFamily: FONT.body,
            fontWeight: 800,
            fontSize: 44,
            transform: `scale(${tw(t, D.ia + 0.35, D.ia + 0.7, 0, 1, ease.outBack)})`,
          }}
        >
          no Venduá Bandeira
        </div>
      </div>
    </AbsoluteFill>
  );
};

// "No WhatsApp, quem atende é o Duá, o vendedor com inteligência artificial: tira dúvida, monta o
// pedido e manda o Pix."
export const Dua: React.FC<{ t: number }> = ({ t }) => {
  const enter = prog(t, START, 0.5, ease.outExpo);
  const exit = prog(t, END - 0.3, 0.3, ease.inExpo);
  const away = t >= REVEAL[0] - 0.05 && t < REVEAL[1] ? prog(t, REVEAL[0] - 0.05, 0.2) * (1 - prog(t, REVEAL[1] - 0.25, 0.25)) : 0;
  const typing = CHAT.some((c, i) => !c.me && t >= c.t - 0.45 && t < c.t) || (t >= D.whats + 0.6 && t < REVEAL[0]);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', inset: 0, perspective: 1800, perspectiveOrigin: '540px 900px' }}>
        <div
          style={{
            position: 'absolute',
            left: 80,
            top: 400,
            width: 920,
            height: 1180,
            borderRadius: 48,
            overflow: 'hidden',
            background: C.chatWall,
            boxShadow: '0 50px 120px rgba(0,0,0,0.5)',
            transformOrigin: '50% 30%',
            transform: `translateY(${(1 - enter) * 900}px) translateX(${-exit * 700}px) rotateX(${8 + (1 - enter) * 45}deg) rotateY(${-6 + 2.5 * Math.sin(t * 1.1) - exit * 80}deg) scale(${1 - away * 0.12})`,
            filter: away || exit ? `blur(${away * 10 + exit * 10}px) brightness(${1 - away * 0.5})` : 'none',
          }}
        >
          <div style={{ height: 130, background: C.forestDeep, display: 'flex', alignItems: 'center', gap: 22, padding: '0 30px' }}>
            <div style={{ fontFamily: FONT.body, fontSize: 52, color: C.cream, marginTop: -6 }}>‹</div>
            <div style={{ width: 82, height: 82, borderRadius: 22, background: C.lime, display: 'grid', placeItems: 'center', ...display(48, C.forest) }}>B</div>
            <div style={{ fontFamily: FONT.body, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 40, color: C.cream }}>Bolos da Nena</div>
              <div style={{ fontWeight: 600, fontSize: 28, color: typing ? C.lime : C.muted }}>{typing ? 'digitando…' : 'online'}</div>
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              top: 130,
              left: 0,
              right: 0,
              bottom: 24,
              padding: '0 26px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              overflow: 'hidden',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 14%)',
            }}
          >
            {CHAT.map((c, i) => (t >= c.t ? <Bubble key={i} i={i} p={prog(t, c.t, 0.22, ease.outCubic)} /> : null))}
          </div>
        </div>
      </div>
      {t >= REVEAL[1] && (
        // an annotation on the window, not part of WhatsApp: who is answering
        <div
          style={{
            position: 'absolute',
            right: 90,
            top: 350,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '8px 26px 8px 8px',
            borderRadius: 99,
            background: C.lime,
            boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
            transform: `scale(${tw(t, REVEAL[1], REVEAL[1] + 0.3, 0, 1, ease.outBack)}) translateX(${exit * -700}px)`,
            transformOrigin: '100% 50%',
          }}
        >
          <Img src={staticFile('dua/avatar-ola.webp')} style={{ width: 68, height: 68, borderRadius: 34, background: C.forest }} />
          <span style={{ fontFamily: FONT.body, fontWeight: 800, fontSize: 36, color: C.forest }}>Duá respondendo</span>
        </div>
      )}
      <Reveal t={t} />
    </AbsoluteFill>
  );
};
