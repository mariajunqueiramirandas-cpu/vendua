import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { Chars, Rise } from '../../../lib/text';
import { DROP, F, FINAL, T } from '../timeline';
import { display, label, Mark, Tape, Words } from '../ui';

// "com um super desconto de lançamento!" — a price tag drops in on its string and swings to rest;
// DESCONTO stamps onto it on the word.
const PIVOT = { x: 540, y: 380 };
const TAG = { w: 600, h: 760, string: 90 };

export const Desconto: React.FC<{ t: number }> = ({ t }) => {
  const w = F.desconto.w;
  const D = T.desconto;
  const tau = t - D.tag;
  const fall = prog(t, D.tag, 0.42, ease.outCubic);
  const knock = kick(t, D.desconto, 0.6);
  const angle = (16 * Math.exp(-3 * tau) * Math.cos(8.5 * tau) + knock * 4 * Math.sin((t - D.desconto) * 20)) * (tau > 0 ? 1 : 0);
  const stamp = prog(t, D.desconto - 0.02, 0.24, ease.outExpo);
  const { x, y } = PIVOT;
  const top = y + TAG.string;
  return (
    <AbsoluteFill>
      <Tape text="Black Friday" x={-300 - (t - DROP) * 240} top={232} rotate={-3} bg={C.lime} fg={C.night} size={50} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1080,
          height: 1920,
          transformOrigin: `${x}px ${y}px`,
          transform: `translateY(${(1 - fall) * -1300}px) rotate(${angle}deg)`,
        }}
      >
        <div style={{ position: 'absolute', left: x - 3, top: y - 400, width: 6, height: 400 + TAG.string + 40, background: C.cream, borderRadius: 3 }} />
        <svg width={TAG.w} height={TAG.h} viewBox={`0 0 ${TAG.w} ${TAG.h}`} style={{ position: 'absolute', left: x - TAG.w / 2, top, overflow: 'visible', filter: 'drop-shadow(0 40px 60px rgba(0,0,0,0.5))' }}>
          <path d={`M ${TAG.w / 2} 0 L ${TAG.w} 150 L ${TAG.w} ${TAG.h - 48} Q ${TAG.w} ${TAG.h} ${TAG.w - 48} ${TAG.h} L 48 ${TAG.h} Q 0 ${TAG.h} 0 ${TAG.h - 48} L 0 150 Z`} fill={C.lime} />
          <circle cx={TAG.w / 2} cy={92} r={30} fill={C.night} />
          <circle cx={TAG.w / 2} cy={92} r={30} fill="none" stroke={C.forest} strokeWidth={6} />
        </svg>
        <div style={{ position: 'absolute', left: x - TAG.w / 2, top: top + 210, width: TAG.w, textAlign: 'center' }}>
          <div style={{ ...display(170, C.forest), letterSpacing: '-0.05em' }}>
            <Rise p={prog(t, w.super - 0.05, 0.3, ease.outExpo)}>SUPER</Rise>
          </div>
          <div
            style={{
              ...display(112, C.forest),
              letterSpacing: '-0.04em',
              marginTop: 18,
              transform: `scale(${1.45 - 0.45 * stamp})`,
              opacity: t >= D.desconto - 0.02 ? Math.min(1, stamp * 3) : 0,
            }}
          >
            DESCONTO
          </div>
          <div style={{ height: 8, width: 380 * stamp, background: C.forest, borderRadius: 4, margin: '26px auto 0' }} />
        </div>
      </div>
      <div style={{ position: 'absolute', top: 1300, width: '100%', display: 'grid', justifyItems: 'center' }}>
        <Words t={t} words={[['de', w.de], ['lançamento!', w.lancamento]]} style={display(96, C.cream)} />
      </div>
    </AbsoluteFill>
  );
};

// "Anota aí: vendua.com.br!" — the name, then the address set word by word as it is said; on the
// last downbeat the launch line and the offer lock in under it and hold.
export const Cta: React.FC<{ t: number }> = ({ t }) => {
  const K = T.cta;
  const [u1, u2, u3] = K.url;
  const mark = prog(t, K.open + 0.05, 0.45, ease.outCubic);
  const fin = kick(t, FINAL, 0.6);
  const ring = prog(t, FINAL, 0.8, ease.outCubic);
  const under = tw(t, u1, u3 + 0.3, 0, 1, ease.outCubic);
  const row = (at: number) => prog(t, at, 0.4, ease.outExpo);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: `radial-gradient(760px 640px at 50% 34%, rgba(18,60,50,0.9), transparent 72%)` }} />
      <div style={{ position: 'absolute', top: 360, width: '100%', display: 'grid', placeItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: -40,
              top: -40,
              width: 240,
              height: 240,
              borderRadius: 120,
              border: `5px solid ${C.lime}`,
              transform: `scale(${0.7 + ring * 1.3})`,
              opacity: t >= FINAL ? (1 - ring) * 0.8 : 0,
            }}
          />
          <Mark size={160} p={mark} style={{ transform: `scale(${1 + fin * 0.08})` }} />
        </div>
      </div>
      <div style={{ position: 'absolute', top: 560, width: '100%', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: 20 }}>
          <Chars
            text="venduá."
            style={{ ...display(210, C.cream), letterSpacing: '-0.06em' }}
            char={(i, n) => ({ transform: `translateY(${(1 - prog(t, K.open + i * 0.03, 0.45, ease.outExpo)) * 105}%)`, color: i === n - 1 ? C.lime : C.cream })}
          />
        </div>
      </div>
      <div style={{ position: 'absolute', top: 880, width: '100%', textAlign: 'center', ...label(42, C.lime), letterSpacing: '0.3em' }}>
        <Rise p={prog(t, K.anota - 0.05, 0.4, ease.outExpo)}>Anota aí</Rise>
      </div>
      <div style={{ position: 'absolute', top: 960, width: '100%', display: 'grid', justifyItems: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', ...display(122, C.cream), letterSpacing: '-0.04em' }}>
          <Rise p={prog(t, u1 - 0.05, 0.3, ease.outExpo)}>vendua</Rise>
          <Rise p={prog(t, u2 - 0.05, 0.3, ease.outExpo)}>.com</Rise>
          <Rise p={prog(t, u3 - 0.05, 0.3, ease.outExpo)} style={{ color: C.lime }}>
            .br
          </Rise>
          <div style={{ position: 'absolute', left: 0, bottom: -16, height: 10, borderRadius: 5, width: `${under * 100}%`, background: C.lime }} />
        </div>
      </div>
      <div style={{ position: 'absolute', top: 1210, width: '100%', display: 'grid', justifyItems: 'center', gap: 22 }}>
        <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 50, color: C.cream, opacity: row(FINAL), transform: `translateY(${(1 - row(FINAL)) * 40}px)` }}>
          Lançamento oficial na Black Friday
        </div>
        <div
          style={{
            padding: '16px 36px',
            borderRadius: 99,
            background: C.lime,
            ...label(40, C.night),
            letterSpacing: '0.08em',
            opacity: row(FINAL + 0.12),
            transform: `translateY(${(1 - row(FINAL + 0.12)) * 40}px) scale(${1 + fin * 0.04})`,
          }}
        >
          sexta, 27/11 · super desconto
        </div>
        <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 36, color: C.muted, marginTop: 14, opacity: row(FINAL + 0.3) }}>@vendua.digital</div>
      </div>
    </AbsoluteFill>
  );
};
