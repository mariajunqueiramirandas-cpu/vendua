import { AbsoluteFill, Img, staticFile } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { rng } from '../../../lib/random';
import { Rise } from '../../../lib/text';
import { G, SCENES, T } from '../timeline';

const D = T.dua;
const END = SCENES.dua[1];

// The sixth system. Bar 7 boots it over the riser (silhouette, a ring filling to 100%); the drop
// brings Duá online on lime, with the shop's WhatsApp conversation orbiting around it.
const BUBBLES: { me: boolean; text: string }[] = [
  { me: true, text: 'Tem bolo de cenoura hoje?' },
  { me: false, text: 'Tem sim! Com brigadeiro.' },
  { me: false, text: 'Entrega ou retirada?' },
  { me: true, text: 'Entrega, por favor!' },
  { me: false, text: 'Anotado! Aqui está o Pix.' },
  { me: true, text: 'Paguei!' },
];

const CX = 540;
const CY = 1000;
const AV = 520;

const Avatar: React.FC<{ style?: React.CSSProperties; tint: string; src?: string }> = ({ style, tint, src = 'dua/avatar-ola.webp' }) => (
  <div style={{ position: 'absolute', left: CX - AV / 2, top: CY - AV / 2, width: AV, height: AV, borderRadius: AV / 2, background: tint, display: 'grid', placeItems: 'center', ...style }}>
    <Img src={staticFile(src)} style={{ width: AV * 0.9, height: AV * 0.9 }} />
  </div>
);

const Boot: React.FC<{ t: number }> = ({ t }) => {
  const pct = tw(t, D.boot + 0.1, D.online - G.beat / 2, 0, 100, ease.inCubic);
  const fr = rng(Math.floor(t * G.fps) + 11);
  const glitch = tw(t, D.boot + 0.8, D.online - G.beat / 2, 0, 1, ease.inCubic);
  const gap = t >= D.online - G.beat / 2;
  const R = 300;
  const circ = 2 * Math.PI * R;
  const band = () => {
    const a = Math.floor(fr() * 85);
    return `inset(${a}% 0 ${Math.max(0, 100 - a - 6 - fr() * 14)}% 0)`;
  };
  const enter = prog(t, D.boot, 0.38, ease.outExpo);
  return (
    <AbsoluteFill style={{ opacity: gap ? 0.35 : 1, transform: `scale(${gap ? 0.94 : 1})` }}>
      <div style={{ position: 'absolute', left: 84, right: 84, top: 360 }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 30, letterSpacing: '0.22em', color: C.lime }}>
          <Rise p={enter}>SISTEMA 06</Rise>
        </div>
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 120, letterSpacing: '-0.05em', lineHeight: 1, color: C.cream, marginTop: 10 }}>
          <Rise p={prog(t, D.boot + 0.03, 0.35, ease.outExpo)}>Vendedor com IA</Rise>
        </div>
        <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 44, color: C.muted, marginTop: 10 }}>
          <Rise p={prog(t, D.boot + 0.12, 0.35, ease.outExpo)}>no WhatsApp da sua loja.</Rise>
        </div>
      </div>
      <svg width={1080} height={1920} style={{ position: 'absolute', left: 0, top: 0 }}>
        <circle cx={CX} cy={CY + 40} r={R} fill="none" stroke="rgba(247,244,234,0.1)" strokeWidth={14} />
        <circle
          cx={CX}
          cy={CY + 40}
          r={R}
          fill="none"
          stroke={C.lime}
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct / 100)}
          transform={`rotate(-90 ${CX} ${CY + 40})`}
          style={{ filter: `drop-shadow(0 0 ${10 + glitch * 30}px ${C.lime})` }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, transform: `translateY(40px) scale(${0.95 * enter})`, transformOrigin: `${CX}px ${CY}px` }}>
        <Avatar tint="transparent" style={{ filter: 'brightness(0) invert(0.92) sepia(1) hue-rotate(30deg) saturate(3)', opacity: 0.18 + 0.5 * (pct / 100) }} />
        {glitch > 0.05 && <Avatar tint="transparent" style={{ filter: 'brightness(0) invert(1)', opacity: 0.6 * glitch, clipPath: band(), transform: `translateX(${(fr() - 0.5) * 60 * glitch}px)` }} />}
      </div>
      <div style={{ position: 'absolute', top: 1376, width: '100%', textAlign: 'center', fontFamily: FONT.display, fontWeight: 700, fontSize: 64, letterSpacing: '0.02em', fontVariantNumeric: 'tabular-nums', color: C.cream, opacity: enter }}>
        carregando <span style={{ color: C.lime }}>{Math.floor(pct)}%</span>
      </div>
    </AbsoluteFill>
  );
};

const Online: React.FC<{ t: number }> = ({ t }) => {
  const g = kick(t, D.online, 0.5);
  const fr = rng(Math.floor(t * G.fps) + 3);
  const pop = tw(t, D.online, D.online + 0.45, 0, 1, ease.outBack);
  const exit = prog(t, D.exit, END - D.exit, ease.inExpo);
  const band = () => {
    const a = Math.floor(fr() * 80);
    return `inset(${a}% 0 ${Math.max(0, 100 - a - 8 - fr() * 18)}% 0)`;
  };
  // the ring spins faster on the words bar
  const spin = (t - D.online) * 0.9 + Math.max(0, t - D.words[0][0]) ** 2 * 0.6;
  const word = D.words.reduce<number>((k, [w], i) => (t >= w ? i : k), -1);
  const lastWord = word === D.words.length - 1;

  const bubbles = BUBBLES.map((m, k) => {
    const s = D.online + G.b(0.5 + k * 0.5);
    if (t < s) return null;
    const a = spin + (k / BUBBLES.length) * Math.PI * 2;
    const z = Math.sin(a);
    const p = prog(t, s, 0.3, ease.outBack);
    // keep the whole bubble inside the safe area, whatever its width
    const w = (m.text.length + (m.me ? 0 : 4)) * 19 + 60;
    const x = Math.min(1016 - w / 2, Math.max(64 + w / 2, CX + Math.cos(a) * 270));
    const y = CY + 20 + z * 250;
    return { k, m, z, p, x, y };
  }).filter((b) => b !== null);

  const Bubble = ({ b }: { b: NonNullable<(typeof bubbles)[number]> }) => (
    <div
      style={{
        position: 'absolute',
        left: b.x,
        top: b.y,
        transform: `translate(-50%, -50%) scale(${(0.72 + 0.28 * (b.z * 0.5 + 0.5)) * (0.4 + 0.6 * b.p)})`,
        opacity: Math.min(1, b.p * 2) * (0.55 + 0.45 * (b.z * 0.5 + 0.5)),
        whiteSpace: 'nowrap',
        padding: '18px 26px',
        borderRadius: 28,
        borderBottomRightRadius: b.m.me ? 8 : 28,
        borderBottomLeftRadius: b.m.me ? 28 : 8,
        background: b.m.me ? C.bubbleMe : C.surface,
        boxShadow: '0 16px 40px rgba(13,42,35,0.25)',
        fontFamily: FONT.body,
        fontWeight: 700,
        fontSize: 36,
        color: '#17221d',
      }}
    >
      {!b.m.me && <span style={{ color: '#2f7a5c', marginRight: 10 }}>Duá</span>}
      {b.m.text}
    </div>
  );

  return (
    <AbsoluteFill style={{ transform: `scale(${1 + exit * 3})`, filter: exit > 0 ? `blur(${exit * 20}px)` : 'none', opacity: 1 - tw(t, END - 0.08, END, 0, 1), transformOrigin: `${CX}px ${CY}px` }}>
      <div style={{ position: 'absolute', top: 370, width: '100%', textAlign: 'center', color: C.forest, fontFamily: FONT.display, fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 0.92 }}>
        {word < 0 ? (
          <>
            <div style={{ fontSize: 170, transform: `scale(${1.6 - 0.6 * prog(t, D.online, 0.25, ease.outExpo)})` }}>Duá:</div>
            <div
              style={{
                display: 'inline-block',
                marginTop: 10,
                padding: '4px 34px 18px',
                borderRadius: 34,
                background: C.forest,
                color: C.lime,
                fontSize: 120,
                transform: `scale(${t >= D.online + G.beat / 2 ? 1.5 - 0.5 * prog(t, D.online + G.beat / 2, 0.25, ease.outExpo) : 0})`,
              }}
            >
              online.
            </div>
          </>
        ) : (
          <span
            style={{
              display: 'inline-block',
              padding: lastWord ? '6px 36px 22px' : 0,
              borderRadius: 30,
              background: lastWord ? C.forest : 'transparent',
              color: lastWord ? C.lime : C.forest,
              fontSize: lastWord ? 112 : 148,
              transform: `scale(${(1.3 - 0.3 * prog(t, D.words[word][0], 0.2, ease.outExpo)) * (1 + kick(t, D.words[word][0], 0.3) * 0.05)})`,
            }}
          >
            {D.words[word][1]}
          </span>
        )}
      </div>
      {bubbles.filter((b) => b.z < 0).map((b) => <Bubble key={b.k} b={b} />)}
      <Avatar tint={C.forest} style={{ transform: `scale(${pop}) rotate(${(1 - pop) * -14}deg)`, boxShadow: `0 0 0 ${18 + g * 40}px rgba(18,60,50,${0.18 + g * 0.3})` }} src="dua/avatar-feliz.webp" />
      {g > 0.05 && <Avatar tint={C.cream} style={{ clipPath: band(), transform: `translateX(${26 * g * (fr() - 0.5) * 2 + 18 * g}px) scale(${pop})`, opacity: 0.8 }} src="dua/avatar-feliz.webp" />}
      {g > 0.05 && <Avatar tint="#5fe0c8" style={{ clipPath: band(), transform: `translateX(${-22 * g}px) scale(${pop})`, opacity: 0.8 }} src="dua/avatar-feliz.webp" />}
      {bubbles.filter((b) => b.z >= 0).map((b) => <Bubble key={b.k} b={b} />)}
      <div style={{ position: 'absolute', top: 1340, width: '100%', textAlign: 'center', fontFamily: FONT.body, fontWeight: 800, fontSize: 52, lineHeight: 1.18, color: C.forest }}>
        <Rise p={prog(t, D.sub, 0.35, ease.outExpo)}>Vendedor com IA</Rise>
        <br />
        <Rise p={prog(t, D.sub + 0.08, 0.35, ease.outExpo)}>no WhatsApp da sua loja.</Rise>
      </div>
    </AbsoluteFill>
  );
};

export const Dua: React.FC<{ t: number }> = ({ t }) => (t < D.online ? <Boot t={t} /> : <Online t={t} />);
