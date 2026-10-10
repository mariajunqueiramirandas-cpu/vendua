import { AbsoluteFill, Img, staticFile } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { Rise } from '../../../lib/text';
import { T } from '../timeline';

const P = T.plans;

// Slot-machine digits that roll from `from` and lock left to right, one every 50 ms.
const Slot: React.FC<{ value: string; t: number; from: number; lock: number; size: number }> = ({ value, t, from, lock, size }) => (
  <span style={{ display: 'inline-flex', fontVariantNumeric: 'tabular-nums' }}>
    {[...value].map((ch, i) => {
      const d = Number(ch);
      if (Number.isNaN(d)) return <span key={i}>{ch}</span>;
      const p = prog(t, from, lock + i * 0.05 - from, ease.outCubic);
      const idx = d + (1 - p) * 20;
      return (
        <span key={i} style={{ display: 'inline-block', height: size, overflow: 'hidden', lineHeight: 1 }}>
          <span style={{ display: 'block', transform: `translateY(${-(idx % 30) * size}px)` }}>
            {Array.from({ length: 31 }, (_, k) => (
              <span key={k} style={{ display: 'block', height: size }}>
                {k % 10}
              </span>
            ))}
          </span>
        </span>
      );
    })}
  </span>
);

const Price: React.FC<{ value: string; t: number; from: number; lock: number; color: string; muted: string }> = ({ value, t, from, lock, color, muted }) => {
  const punch = kick(t, lock + (value.length - 1) * 0.05, 0.3);
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, color, marginTop: 18, transformOrigin: '0% 70%', transform: `scale(${1 + punch * 0.06})` }}>
      <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 84, letterSpacing: '-0.04em' }}>R$</span>
      <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 210, letterSpacing: '-0.06em', lineHeight: 1 }}>
        <Slot value={value} t={t} from={from} lock={lock} size={210} />
      </span>
      <span style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 54, color: muted }}>/mês</span>
    </div>
  );
};

const Perk: React.FC<{ p: number; mark: React.ReactNode; children: React.ReactNode; color: string }> = ({ p, mark, children, color }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      fontFamily: FONT.body,
      fontWeight: 700,
      fontSize: 44,
      color,
      marginTop: 18,
      opacity: Math.min(1, p * 2),
      transform: `translateX(${(1 - p) * -60}px)`,
    }}
  >
    {mark}
    {children}
  </div>
);

const check = (c: string) => (
  <svg viewBox="0 0 128 128" width={46} height={46}>
    <path d="M32 48 L61 88 L98 34" fill="none" stroke={c} strokeWidth={19} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const plus = <span style={{ width: 46, textAlign: 'center', color: C.lime, fontFamily: FONT.display, fontSize: 58, lineHeight: 1 }}>+</span>;

const face: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 52,
  padding: '64px 64px',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  boxShadow: '0 60px 140px rgba(0,0,0,0.5)',
};

export const Plans: React.FC<{ t: number }> = ({ t }) => {
  const enter = prog(t, P.mirim, 0.45, ease.outExpo);
  const flip = prog(t, P.flip, P.bandeira - P.flip, ease.inOutCubic);
  const back = t >= P.bandeira;
  const ry = (1 - enter) * -120 + flip * 180 + 4 * Math.sin(t * 1.6);
  const sweep = prog(t, P.sweep, 0.6, ease.inOutCubic);
  const duaPop = tw(t, P.perks[1], P.perks[1] + 0.35, 0, 1, ease.outBack);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          right: -40,
          top: 380,
          fontFamily: FONT.display,
          fontWeight: 700,
          fontSize: 900,
          lineHeight: 0.8,
          letterSpacing: '-0.08em',
          color: 'transparent',
          WebkitTextStroke: '3px rgba(217,248,117,0.12)',
          transform: `translateY(${tw(t, P.mirim, P.mirim + 4, 40, -60, ease.linear)}px)`,
        }}
      >
        R$
      </div>
      <div style={{ position: 'absolute', top: 280, left: 90, fontFamily: FONT.display, fontWeight: 700, fontSize: 118, letterSpacing: '-0.05em', color: C.cream }}>
        {back ? <Rise p={prog(t, P.bandeira, 0.35, ease.outExpo)}>O completo:</Rise> : <Rise p={prog(t, P.mirim, 0.35, ease.outExpo)}>Pra começar:</Rise>}
      </div>
      <div style={{ position: 'absolute', inset: 0, perspective: 2400, perspectiveOrigin: '540px 950px' }}>
        <div
          style={{
            position: 'absolute',
            left: 90,
            top: 560,
            width: 900,
            height: 780,
            transformStyle: 'preserve-3d',
            transform: `translateZ(${(1 - enter) * -700 - Math.sin(flip * Math.PI) * 260}px) rotateY(${ry}deg) rotateX(${3 * Math.sin(t * 1.2)}deg)`,
          }}
        >
          <div style={{ ...face, background: C.surface, color: C.forest, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 56 }}>Venduá Mirim</div>
            <Price value="69,90" t={t} from={P.mirim} lock={P.mirimLock} color={C.forest} muted="#4d6159" />
            <div style={{ marginTop: 26 }}>
              {['Sua loja online', 'Cardápio, pedidos e Pix', 'Cupons'].map((s, i) => (
                <Perk key={s} p={prog(t, P.mirimPerks + i * 0.07, 0.3, ease.outExpo)} mark={check(C.forest)} color={C.forest}>
                  {s}
                </Perk>
              ))}
            </div>
          </div>
          <div style={{ ...face, background: C.forest, color: C.cream, border: `5px solid ${C.lime}`, transform: 'rotateY(180deg)', overflow: 'visible' }}>
            <div
              style={{
                position: 'absolute',
                left: 64,
                top: -34,
                padding: '10px 30px',
                borderRadius: 99,
                background: C.lime,
                color: C.forest,
                fontFamily: FONT.body,
                fontWeight: 800,
                fontSize: 36,
              }}
            >
              Recomendado
            </div>
            <div
              style={{
                position: 'absolute',
                right: -36,
                top: -90,
                width: 250,
                height: 250,
                borderRadius: 125,
                background: C.lime,
                display: 'grid',
                placeItems: 'center',
                transform: `scale(${duaPop}) rotate(${(1 - duaPop) * 30}deg)`,
              }}
            >
              <Img src={staticFile('dua/avatar-feliz.webp')} style={{ width: 230, height: 230 }} />
            </div>
            <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 56 }}>Venduá Bandeira</div>
            <Price value="169" t={t} from={P.bandeira - 0.1} lock={P.bandeiraLock} color={C.cream} muted={C.muted} />
            <div style={{ marginTop: 18 }}>
              {['Tudo do Mirim', 'o Duá, vendedor com IA', 'Tela da cozinha', 'Cartão fidelidade'].map((s, i) => (
                <Perk key={s} p={prog(t, P.perks[i], 0.3, ease.outExpo)} mark={plus} color={C.cream}>
                  {s}
                </Perk>
              ))}
            </div>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 48,
                background: `linear-gradient(110deg, transparent ${sweep * 140 - 40}%, rgba(217,248,117,0.28) ${sweep * 140 - 25}%, transparent ${sweep * 140 - 10}%)`,
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
