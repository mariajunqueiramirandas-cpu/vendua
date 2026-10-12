import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, prog, tw } from '../../../lib/motion';
import { LAUNCH, SCENES, T } from '../timeline';
import { fadeOut, reveal } from '../ui';

const D = T.date;

// The date, given room: a label, the day written out, the year filling in, the weekday.
export const DateReveal: React.FC<{ t: number }> = ({ t }) => {
  const sweep = prog(t, D.long, 1.2, ease.inOutCubic);
  const fill = prog(t, D.year + 0.2, 1.4, ease.inOutCubic);
  const gleam = tw(t, D.long + 0.2, D.long + 1.6, -30, 130, ease.inOutCubic);
  return (
    <AbsoluteFill style={{ opacity: fadeOut(t, SCENES.date[1]), transform: `scale(${tw(t, D.hit, SCENES.date[1] + 0.5, 1, 1.05, ease.linear)})` }}>
      <div style={{ position: 'absolute', top: 600, width: '100%', textAlign: 'center', fontFamily: FONT.display, fontWeight: 600, fontSize: 34, letterSpacing: '0.34em', color: C.lime, ...reveal(t, D.hit + 0.1, 1.2, 20) }}>
        LANÇAMENTO OFICIAL
      </div>
      <div style={{ position: 'absolute', top: 690, width: '100%', textAlign: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            fontFamily: FONT.display,
            fontWeight: 600,
            fontSize: 150,
            letterSpacing: '-0.045em',
            lineHeight: 1.05,
            color: 'transparent',
            backgroundImage: `linear-gradient(100deg, ${C.cream} ${gleam - 25}%, #ffffff ${gleam - 8}%, ${C.lime} ${gleam}%, #ffffff ${gleam + 8}%, ${C.cream} ${gleam + 25}%)`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            clipPath: `inset(-20% ${100 - sweep * 100}% -20% 0)`,
            filter: sweep < 0.999 ? `blur(${(1 - sweep) * 8}px)` : 'none',
          }}
        >
          {LAUNCH.long}
        </span>
      </div>
      <div style={{ position: 'absolute', top: 880, width: '100%', textAlign: 'center', ...reveal(t, D.year, 1.2, 40) }}>
        <span style={{ position: 'relative', display: 'inline-block', fontFamily: FONT.display, fontWeight: 700, fontSize: 330, letterSpacing: '-0.055em', lineHeight: 1 }}>
          <span style={{ color: 'transparent', WebkitTextStroke: `3px rgba(247,244,234,0.55)` }}>{LAUNCH.year}</span>
          <span style={{ position: 'absolute', left: 0, top: 0, color: C.lime, clipPath: `inset(${100 - fill * 100}% 0 0 0)` }}>{LAUNCH.year}</span>
        </span>
      </div>
      <div style={{ position: 'absolute', top: 1280, width: '100%', textAlign: 'center', fontFamily: FONT.body, fontWeight: 600, fontSize: 52, color: C.muted, ...reveal(t, D.weekday) }}>
        {LAUNCH.weekday[0].toUpperCase() + LAUNCH.weekday.slice(1)}. <span style={{ color: C.cream }}>Marque na agenda.</span>
      </div>
    </AbsoluteFill>
  );
};
