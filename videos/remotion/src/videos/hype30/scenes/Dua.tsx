import { AbsoluteFill, Img, staticFile } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { rng } from '../../../lib/random';
import { Rise, split } from '../../../lib/text';
import { G, SCENES, T } from '../timeline';

const D = T.dua;
const END = SCENES.dua[1];

type Msg = { me: boolean; text: string; extra?: 'pix' | 'paid' };
const MSGS: Msg[] = [
  { me: true, text: 'Tem bolo de cenoura?' },
  { me: false, text: 'Tem sim! O inteiro sai R$ 45,00.' },
  { me: false, text: 'Quer uma fatia de chocolate pra hoje? R$ 9,50.' },
  { me: true, text: 'Quero!' },
  { me: false, text: 'Entrega ou retirada?' },
  { me: true, text: 'Entrega, Rua das Acácias, 120' },
  { me: false, text: 'Pedido feito! Total com a entrega: R$ 62,50. Aqui está o Pix:', extra: 'pix' },
  { me: true, text: 'Paguei!' },
  { me: false, text: 'Pagamento confirmado! Seu pedido já foi para a cozinha.', extra: 'paid' },
];

const Check: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg viewBox="0 0 128 128" width={size} height={size}>
    <path d="M32 48 L61 88 L98 34" fill="none" stroke={color} strokeWidth={17} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// A stand-in QR: a fixed pattern of squares, not a payable code.
const QR: React.FC = () => {
  const r = rng(30);
  const cells = Array.from({ length: 121 }, () => r() > 0.52);
  const finder = (x: number, y: number) => (x < 3 && y < 3) || (x > 7 && y < 3) || (x < 3 && y > 7);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(11, 11px)', gap: 1, padding: 8, background: '#fff', borderRadius: 10 }}>
      {cells.map((on, i) => {
        const x = i % 11;
        const y = Math.floor(i / 11);
        return <div key={i} style={{ width: 11, height: 11, background: finder(x, y) || on ? C.night : 'transparent', borderRadius: 2 }} />;
      })}
    </div>
  );
};

const Bubble: React.FC<{ m: Msg; p: number }> = ({ m, p }) => (
  <div style={{ maxHeight: p * 600, overflow: 'hidden', flex: 'none', display: 'flex', justifyContent: m.me ? 'flex-end' : 'flex-start', marginTop: 16 * Math.min(1, p * 2) }}>
    <div
      style={{
        maxWidth: '80%',
        padding: '20px 26px 14px',
        borderRadius: 30,
        borderTopRightRadius: m.me ? 8 : 30,
        borderTopLeftRadius: m.me ? 30 : 8,
        background: m.me ? C.bubbleMe : C.surface,
        boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
        fontFamily: FONT.body,
        fontWeight: 600,
        fontSize: 36,
        lineHeight: 1.25,
        color: '#17221d',
        transformOrigin: m.me ? '100% 0%' : '0% 0%',
        transform: `scale(${0.6 + 0.4 * ease.outBack(Math.min(1, p))})`,
        opacity: Math.min(1, p * 3),
      }}
    >
      {m.text}
      {m.extra === 'pix' && (
        <div style={{ display: 'flex', gap: 22, alignItems: 'center', marginTop: 16, padding: 16, borderRadius: 22, background: '#f1f5ef' }}>
          <QR />
          <div>
            <div style={{ fontWeight: 800, fontSize: 32 }}>Pix · R$ 62,50</div>
            <div style={{ fontSize: 26, color: '#4d6159', marginTop: 4 }}>Pedido #30</div>
            <div style={{ display: 'inline-block', marginTop: 12, padding: '8px 20px', borderRadius: 99, background: C.lime, color: C.forest, fontWeight: 800, fontSize: 26 }}>
              copiar código
            </div>
          </div>
        </div>
      )}
      {m.extra === 'paid' && (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 14, padding: '12px 18px', borderRadius: 20, background: C.forest, color: C.cream, fontWeight: 700, fontSize: 28 }}>
          <Check size={34} color={C.lime} /> Pedido #30 · aceito pela loja
        </div>
      )}
      <div style={{ textAlign: 'right', fontSize: 20, color: '#6d7d75', marginTop: 4 }}>9:41</div>
    </div>
  </div>
);

export const Dua: React.FC<{ t: number }> = ({ t }) => {
  const chat = t >= D.chat;
  const g = kick(t, D.line1, 0.45);
  const fr = rng(Math.floor(t * G.fps) + 3);
  const pop = tw(t, D.line1, D.line1 + 0.45, 0, 1, ease.outBack);

  if (!chat) {
    const avatar = (dx: number, tint: string, clip: string) => (
      <div
        style={{
          position: 'absolute',
          left: 240 + dx,
          top: 700,
          width: 600,
          height: 600,
          borderRadius: 300,
          background: tint,
          clipPath: clip,
          transform: `scale(${pop}) rotate(${(1 - pop) * -14}deg)`,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Img src={staticFile('dua/avatar-ola.webp')} style={{ width: 530, height: 530 }} />
      </div>
    );
    const band = () => {
      const a = Math.floor(fr() * 80);
      return `inset(${a}% 0 ${Math.max(0, 100 - a - 8 - fr() * 18)}% 0)`;
    };
    return (
      <AbsoluteFill>
        <div style={{ position: 'absolute', top: 280, width: '100%', textAlign: 'center', fontFamily: FONT.display, fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 0.9, color: C.forest }}>
          <div style={{ fontSize: 130, transform: `scale(${1.5 - 0.5 * prog(t, D.line1, 0.25, ease.outExpo)})` }}>Conheça</div>
          <div style={{ fontSize: 230, transform: `scale(${1.6 - 0.6 * prog(t, D.line2, 0.25, ease.outExpo)})`, opacity: t >= D.line2 ? 1 : 0 }}>o Duá.</div>
        </div>
        {avatar(0, C.forest, 'none')}
        {g > 0.05 && avatar(26 * g * (fr() - 0.5) * 2 + 18 * g, C.lime, band())}
        {g > 0.05 && avatar(-22 * g, '#5fe0c8', band())}
        <div style={{ position: 'absolute', top: 1370, width: '100%', textAlign: 'center', fontFamily: FONT.body, fontWeight: 800, fontSize: 62, lineHeight: 1.18, color: C.forest }}>
          <Rise p={prog(t, D.sub1, 0.35, ease.outExpo)}>Vendedor com IA</Rise>
          <br />
          <Rise p={prog(t, D.sub2, 0.35, ease.outExpo)}>no WhatsApp da sua loja.</Rise>
        </div>
      </AbsoluteFill>
    );
  }

  const enter = prog(t, D.chat, 0.45, ease.outExpo);
  const exit = prog(t, D.exit, END - D.exit, ease.inExpo);
  const typing = D.msgs.some((m, i) => !MSGS[i].me && t >= m - 0.35 && t < m);
  const word = D.words.reduce<number>((k, [w], i) => (t >= w ? i : k), -1);
  const sold = word === D.words.length - 1;

  return (
    <AbsoluteFill>
      {word >= 0 && (
        <div style={{ position: 'absolute', top: 270, width: '100%', textAlign: 'center', transform: `translateY(${-exit * 300}px)`, opacity: 1 - exit }}>
          <span
            style={{
              display: 'inline-block',
              padding: sold ? '0 30px 10px' : 0,
              borderRadius: 26,
              background: sold ? C.lime : 'transparent',
              fontFamily: FONT.display,
              fontWeight: 700,
              fontSize: word === 3 ? 128 : 150,
              letterSpacing: '-0.05em',
              color: sold ? C.forest : C.cream,
              transform: `scale(${(1.4 - 0.4 * prog(t, D.words[word][0], 0.2, ease.outExpo)) * (1 + kick(t, D.words[word][0], 0.3) * (sold ? 0.12 : 0))})`,
              textShadow: sold ? 'none' : split(kick(t, D.words[word][0], 0.3), 12),
            }}
          >
            {D.words[word][1]}
          </span>
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, perspective: 1800, perspectiveOrigin: '540px 900px' }}>
        <div
          style={{
            position: 'absolute',
            left: 100,
            top: 560,
            width: 880,
            height: 1000,
            borderRadius: 48,
            overflow: 'hidden',
            background: C.chatWall,
            boxShadow: '0 50px 120px rgba(0,0,0,0.5)',
            transformOrigin: '50% 30%',
            transform: `translateY(${(1 - enter) * 700}px) translateX(${-exit * 600}px) rotateX(${12 + (1 - enter) * 50}deg) rotateY(${-8 + 3 * Math.sin(t * 1.1) - exit * 95}deg) rotateZ(${1.5 + Math.sin(t * 0.8)}deg) scale(${1 + tw(t, D.chat, D.exit, 0, 0.06, ease.linear)})`,
            filter: exit > 0 ? `blur(${exit * 10}px)` : 'none',
          }}
        >
          <div style={{ height: 124, background: C.forestDeep, display: 'flex', alignItems: 'center', gap: 22, padding: '0 30px' }}>
            <div style={{ fontFamily: FONT.body, fontSize: 52, color: C.cream, marginTop: -6 }}>‹</div>
            <div style={{ width: 80, height: 80, borderRadius: 40, background: C.lime, overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
              <Img src={staticFile('dua/avatar-ola.webp')} style={{ width: 76, height: 76 }} />
            </div>
            <div style={{ fontFamily: FONT.body }}>
              <div style={{ fontWeight: 700, fontSize: 38, color: C.cream }}>Bolos da Nena</div>
              <div style={{ fontWeight: 600, fontSize: 27, color: typing ? C.lime : C.muted }}>{typing ? 'digitando…' : 'online'}</div>
            </div>
          </div>
          <div style={{ position: 'absolute', top: 124, left: 0, right: 0, bottom: 26, padding: '0 28px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 16%)' }}>
            {MSGS.map((m, i) => (t >= D.msgs[i] ? <Bubble key={i} m={m} p={prog(t, D.msgs[i], 0.22, ease.outCubic)} /> : null))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
