import { AbsoluteFill } from 'remotion';
import { C, FONT, H, W } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { ParticleText } from '../../../lib/particles';
import { Rise, split } from '../../../lib/text';
import { display, Mark, slam } from '../kit';
import { SCENES, T } from '../timeline';

const L = T.launch;
const END = SCENES.launch[1];

// "Neste sábado, entra no ar o Venduá!": the date first, then the name assembles out of
// particles and lands on the drop, where the world turns lime.
export const Launch: React.FC<{ t: number }> = ({ t }) => {
  const hit = t >= L.brand;
  const gone = prog(t, L.brand - 0.12, 0.2, ease.inCubic);
  const e = prog(t, END - 0.35, 0.35, ease.inCubic);
  const land = prog(t, L.brand, 0.9, ease.outExpo);
  return (
    <AbsoluteFill>
      {gone < 1 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 330,
            textAlign: 'center',
            transform: `scale(${1 + gone * 1.5})`,
            filter: gone ? `blur(${gone * 24}px)` : 'none',
            opacity: 1 - gone,
          }}
        >
          <div style={{ ...display(110, C.cream) }}>
            <Rise p={prog(t, L.neste, 0.3, ease.outExpo)}>Neste</Rise>
          </div>
          <div style={{ ...display(270, C.lime), marginTop: 10, textShadow: split(kick(t, L.sabado, 0.35), 16), ...slam(t, L.sabado, 1.8) }}>sábado</div>
          <div
            style={{
              display: 'inline-block',
              marginTop: 34,
              padding: '14px 44px 20px',
              borderRadius: 99,
              background: C.cream,
              ...display(110, C.forest),
              ...slam(t, L.sabado + 0.22, 1.5),
            }}
          >
            24/10
          </div>
          <div style={{ ...display(96, C.cream), marginTop: 40 }}>
            <Rise p={prog(t, L.entra, 0.3, ease.outExpo)}>entra no ar o</Rise>
          </div>
        </div>
      )}
      <ParticleText
        text="venduá"
        font="700 250px 'Space Grotesk'"
        width={W}
        height={H}
        center={[540, hit ? 1080 : 1160]}
        count={16000}
        colors={hit ? [C.forest, C.night] : [C.lime, C.cream]}
        p={prog(t, L.entra - 0.25, L.brand - L.entra + 0.25, ease.linear)}
        e={e}
        t={t}
        size={3.4}
      />
      {hit && (
        <>
          <div style={{ opacity: 1 - e, transform: `scale(${1 + e * e * 3})`, filter: e ? `blur(${e * 14}px)` : 'none', transformOrigin: '540px 700px' }}>
            {/* the app icon, flat as the brand draws it: a sticker's hard shadow, the check drawing on */}
            <div
              style={{
                position: 'absolute',
                left: 540 - 200,
                top: 650 - 200,
                width: 400,
                height: 400,
                transform: `scale(${tw(t, L.brand, L.brand + 0.4, 0.3, 1, ease.outBack) * (1 + kick(t, L.brand + 0.42, 0.3) * 0.05)}) rotate(${(1 - land) * -12}deg)`,
              }}
            >
              <div style={{ position: 'absolute', left: 0, top: 22, width: 400, height: 400, borderRadius: 88, background: 'rgba(13,42,35,0.28)' }} />
              <Mark size={400} p={prog(t, L.brand + 0.1, 0.32, ease.outCubic)} color={C.lime} bg={C.forest} style={{ left: 0, top: 0 }} />
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              top: 1300,
              width: '100%',
              textAlign: 'center',
              fontFamily: FONT.body,
              fontWeight: 800,
              fontSize: 66,
              color: C.forest,
              opacity: 1 - e,
            }}
          >
            <Rise p={prog(t, L.brand + 0.75, 0.35, ease.outExpo)}>chega sábado, 24/10</Rise>
          </div>
        </>
      )}
    </AbsoluteFill>
  );
};
