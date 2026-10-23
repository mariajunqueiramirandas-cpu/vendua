import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog } from '../../../lib/motion';
import { rng } from '../../../lib/random';
import { split } from '../../../lib/text';
import { display, slam } from '../kit';
import { SCENES, T } from '../timeline';

const H = T.hook;
const END = SCENES.hook[1];

// Shoppers writing to the store's WhatsApp faster than anyone can answer; the last one gives up.
const NOTES = [
  ['Ana', 'Oi, ainda tem bolo de cenoura?'],
  ['Carla', 'Moça, aceita Pix?'],
  ['Bruno', 'Qual o valor do bolo de milho?'],
  ['Ana', '??'],
  ['Rafael', 'Faz entrega no Centro?'],
  ['Carla', 'Oi?'],
  ['Ana', 'Deixa, vou pedir em outro lugar 😕'],
] as const;

const Bubble: React.FC = () => (
  <svg viewBox="0 0 64 64" width={46} height={46}>
    <path d="M32 10c-12.7 0-23 9.2-23 20.6 0 4.6 1.7 8.8 4.6 12.2L11 54l11.7-4.1c2.9 1.2 6 1.8 9.3 1.8 12.7 0 23-9.2 23-20.6S44.7 10 32 10z" fill="#fff" />
  </svg>
);

const Note: React.FC<{ t: number; i: number }> = ({ t, i }) => {
  const at = H.notes[i];
  if (t < at) return null;
  const r = rng(i * 7 + 3);
  // the first one has already landed on frame 0
  const p = i === 0 ? 1 : prog(t, at, 0.3, ease.outBack);
  const lost = i === NOTES.length - 1;
  const age = H.notes.filter((x, j) => j > i && t >= x).length;
  const x = 540 + (r() - 0.5) * 70;
  const y = lost ? 1180 : 960 + (i % 4) * 92 + r() * 20;
  const rot = lost ? -2 : (r() - 0.5) * 9;
  const [name, msg] = NOTES[i];
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 440,
        top: y,
        width: 880,
        padding: '24px 28px',
        borderRadius: 38,
        background: lost ? '#fff4ef' : 'rgba(246,244,237,0.97)',
        boxShadow: lost ? '0 0 0 6px #ff6b4a, 0 40px 90px rgba(0,0,0,0.55)' : '0 26px 60px rgba(0,0,0,0.45)',
        display: 'flex',
        gap: 24,
        alignItems: 'center',
        transform: `translateY(${(1 - p) * -90}px) rotate(${rot}deg) scale(${1.25 - 0.25 * p})`,
        opacity: Math.min(1, p * 3),
        filter: age ? `brightness(${Math.max(0.55, 1 - age * 0.12)})` : 'none',
      }}
    >
      <div style={{ width: 84, height: 84, borderRadius: 22, background: '#25a95a', display: 'grid', placeItems: 'center', flex: 'none' }}>
        <Bubble />
      </div>
      <div style={{ flex: 1, minWidth: 0, fontFamily: FONT.body, color: '#17221d' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26, fontWeight: 700, color: '#5b6b63', letterSpacing: '0.04em' }}>
          <span>WHATSAPP</span>
          <span style={{ letterSpacing: 0 }}>agora</span>
        </div>
        <div style={{ fontSize: 40, fontWeight: 800, marginTop: 2 }}>{name}</div>
        <div style={{ fontSize: 38, fontWeight: 600, color: lost ? '#b8341b' : '#3c4c44', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg}</div>
      </div>
    </div>
  );
};

// "Para de perder pedido no WhatsApp!": the problem in the first second, word by word over a
// pile of unanswered messages. Frame 0 is already moving.
export const Hook: React.FC<{ t: number }> = ({ t }) => {
  const exit = prog(t, END - 0.2, 0.2, ease.inCubic);
  const buzz = Math.max(kick(t, 0.02, 0.45), kick(t, H.notes[6] + 0.234, 0.45));
  const jx = Math.sin(t * 190) * 9 * buzz;
  const unread = H.notes.filter((x) => t >= x).length;
  return (
    <AbsoluteFill style={{ transform: `scale(${1 + exit * 0.5})`, filter: exit ? `blur(${exit * 20}px)` : 'none', opacity: 1 - exit * 0.6 }}>
      <div style={{ position: 'absolute', inset: 0, transform: `translateX(${jx}px)` }}>
        {NOTES.map((_, i) => (
          <Note key={i} t={t} i={i} />
        ))}
        <div
          style={{
            position: 'absolute',
            left: 930,
            top: 905,
            minWidth: 96,
            height: 96,
            padding: '0 18px',
            borderRadius: 48,
            background: '#ff4d2e',
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontFamily: FONT.body,
            fontWeight: 900,
            fontSize: 52,
            boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
            transform: `translateX(-50%) scale(${1 + kick(t, H.notes[unread - 1] ?? 0, 0.2) * 0.25})`,
          }}
        >
          {unread}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, top: 230, textShadow: '0 10px 40px rgba(0,0,0,0.6)' }}>
        {/* on screen from frame 0, a beat before it is said: the first frame has to read */}
        <div style={{ ...display(130, C.cream), transformOrigin: '0% 100%', ...slam(t, -0.1, 1.25, 0.15) }}>Para de</div>
        <div style={{ ...display(240, C.lime), transformOrigin: '0% 100%', textShadow: split(kick(t, H.perder, 0.35), 14), ...slam(t, H.perder) }}>perder</div>
        <div style={{ ...display(240, C.cream), transformOrigin: '0% 100%', ...slam(t, H.pedido) }}>pedido</div>
        <div style={{ ...display(112, C.cream), marginTop: 10, transformOrigin: '0% 100%', ...slam(t, H.whats, 1.4) }}>no WhatsApp!</div>
      </div>
    </AbsoluteFill>
  );
};
