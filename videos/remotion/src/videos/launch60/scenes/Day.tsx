import { AbsoluteFill } from 'remotion';
import { ease, prog } from '../../../lib/motion';
import { PHONE, camAt, Device, Ring } from '../kit';
import { SCENES, SHOTS, T } from '../timeline';

const D = T.day;
const START = SCENES.day[0];

// "No fim do dia, você vê quanto vendeu e o que mais saiu": Início after closing, the day's total
// against the same weekday last week, then the recap with the day's best seller.
export const Day: React.FC<{ t: number }> = ({ t }) => {
  const enter = prog(t, START, 0.5, ease.outExpo);
  const cam = camAt(t, [
    [START, { x: 187, y: 406, z: 0.92, rx: 6, ry: 12 }],
    [D.quanto - 0.15, { x: 187, y: 380, z: 1.45, ry: 4 }, 0.45],
    [D.saiu - 0.3, { x: 187, y: 610, z: 1.5, ry: -4 }, 0.45],
  ]);
  return (
    <AbsoluteFill>
      <Device
        shot={SHOTS.seudia}
        t={t}
        width={PHONE}
        cx={540 + (1 - enter) * 900}
        cy={1080}
        cam={{ ...cam, ry: (cam.ry ?? 0) - (1 - enter) * 40 }}
      >
        {(s) => (
          <>
            <Ring t={t} at={D.vendeu} s={s} x={10} y={300} w={300} h={110} until={D.saiu - 0.3} />
            <Ring t={t} at={D.saiu} s={s} x={14} y={555} w={346} h={115} />
          </>
        )}
      </Device>
    </AbsoluteFill>
  );
};
