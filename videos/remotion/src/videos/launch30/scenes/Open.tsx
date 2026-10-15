import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, prog, tw } from '../../../lib/motion';
import { Words, fadeOut } from '../ui';
import { SCENES, T } from '../timeline';

const O = T.open;
const head: React.CSSProperties = { fontFamily: FONT.display, fontWeight: 600, fontSize: 92, letterSpacing: '-0.04em', lineHeight: 1.02 };

export const Open: React.FC<{ t: number }> = ({ t }) => {
  const line = prog(t, O.line2 + 0.3, 1.2, ease.inOutCubic);
  return (
    <AbsoluteFill style={{ opacity: fadeOut(t, SCENES.open[1]), transform: `scale(${tw(t, 0, SCENES.open[1] + 0.5, 1, 1.05, ease.linear)})` }}>
      <div style={{ position: 'absolute', left: 96, right: 96, top: 760 }}>
        <div style={{ ...head, color: C.muted }}>
          <Words t={t} start={O.line1} text="Toda grande loja" gap={0.12} />
        </div>
        <div style={{ ...head, color: C.cream, marginTop: 6 }}>
          <Words t={t} start={O.line2} text="começou pequena." gap={0.12} />
        </div>
        <div style={{ marginTop: 56, height: 4, width: 220 * line, borderRadius: 2, background: C.lime }} />
      </div>
    </AbsoluteFill>
  );
};
