import { AbsoluteFill } from 'remotion';
import { C } from '../../../lib/brand';
import { ease, kick, prog } from '../../../lib/motion';
import { Chars } from '../../../lib/text';
import { F, T } from '../timeline';
import { display, label, Mark } from '../ui';

// "Vem aí a Venduá!" — "Vem aí" lands big in the middle, then steps up into an eyebrow as the name
// builds itself letter by letter out of its baseline (as on the site's hero); the check draws on above.
export const Brand: React.FC<{ t: number }> = ({ t }) => {
  const w = F.brand.w;
  const eyebrow = prog(t, w.vem - 0.05, 0.4, ease.outExpo);
  const step = prog(t, T.brand.letters - 0.12, 0.38, ease.inOutCubic);
  const mark = prog(t, T.brand.mark, 0.42, ease.outCubic);
  const glow = prog(t, T.brand.letters, 0.8, ease.outCubic);
  const land = kick(t, T.brand.mark + 0.4, 0.5);

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{ background: `radial-gradient(620px 420px at 50% 47%, rgba(217,248,117,${0.13 * glow}), transparent 72%)` }}
      />
      <div style={{ position: 'absolute', top: 470, width: '100%', display: 'grid', placeItems: 'center' }}>
        <Mark size={170} p={mark} style={{ transform: `scale(${1 + land * 0.06})` }} />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 700,
          width: '100%',
          textAlign: 'center',
          ...label(46, C.lime),
          letterSpacing: '0.34em',
          opacity: eyebrow,
          transformOrigin: '50% 50%',
          transform: `translateY(${(1 - eyebrow) * 40 + (1 - step) * 190}px) scale(${1 + (1 - step) * 1.9})`,
        }}
      >
        Vem aí
      </div>
      <div style={{ position: 'absolute', top: 790, width: '100%', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: 24 }}>
          <Chars
            text="venduá."
            style={{ ...display(250, C.cream), letterSpacing: '-0.06em' }}
            char={(i, n) => {
              const p = prog(t, T.brand.letters + i * 0.035, 0.5, ease.outExpo);
              return {
                transform: `translateY(${(1 - p) * 105}%)`,
                color: i === n - 1 ? C.lime : C.cream,
              };
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
