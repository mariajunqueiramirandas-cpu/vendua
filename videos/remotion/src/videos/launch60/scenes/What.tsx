import { AbsoluteFill } from 'remotion';
import { ease, prog, tw } from '../../../lib/motion';
import { PHONE, camAt, Device, Ring } from '../kit';
import { SCENES, SHOTS, T, timeOf, UI } from '../timeline';

const A = T.what;
const START = SCENES.what[0];
const ROLL = timeOf(SHOTS.inicio, UI.inicio.marks.rola);

// "Sua loja online com a sua cara, e um app no celular pra tocar o dia": the storefront the
// shopper sees, then the admin's Início beside it, where a sale rolls today's total up.
export const What: React.FC<{ t: number }> = ({ t }) => {
  const enter = prog(t, START, 0.5, ease.outExpo);
  const aside = prog(t, A.app - 0.3, 0.5, ease.inOutCubic);
  const shop = camAt(t, [
    [START, { x: 187, y: 406, z: 0.92, rx: 10, ry: -12 }],
    [A.loja, { x: 187, y: 380, z: 0.98, rx: 4, ry: -6 }, 0.8],
    [A.app - 0.3, { x: 187, y: 406, z: 0.66, rx: 4, ry: 22 }, 0.5],
  ]);
  const admEnter = prog(t, A.app - 0.25, 0.5, ease.outExpo);
  const adm = camAt(t, [
    [A.app - 0.25, { x: 187, y: 406, z: 0.8, rx: 4, ry: -14 }],
    [ROLL - 0.5, { x: 187, y: 400, z: 1.22, rx: 2, ry: -6 }, 0.5],
  ]);
  return (
    <AbsoluteFill>
      {t < SCENES.what[1] && (
        <Device
          shot={SHOTS.loja}
          t={t}
          width={PHONE}
          cx={tw(t, A.app - 0.3, A.app + 0.2, 540, 330, ease.inOutCubic)}
          cy={1080 + (1 - enter) * 1100}
          cam={{ ...shop, rx: (shop.rx ?? 0) + (1 - enter) * 40 }}
          style={{ filter: `brightness(${1 - aside * 0.35})` }}
        />
      )}
      {t >= SHOTS.inicio.from && (
        <Device
          shot={SHOTS.inicio}
          t={t}
          width={PHONE}
          cx={tw(t, A.app - 0.25, A.app + 0.25, 1500, 700, ease.outExpo)}
          cy={1100}
          cam={{ ...adm, rz: (1 - admEnter) * 10 }}
        >
          {(s) => <Ring t={t} at={ROLL + 0.05} s={s} x={8} y={350} w={300} h={70} />}
        </Device>
      )}
    </AbsoluteFill>
  );
};
