import { AbsoluteFill } from 'remotion';
import { C } from '../../../lib/brand';
import { ease, prog } from '../../../lib/motion';
import { PHONE, camAt, Check, Chip, Device, Ring } from '../kit';
import { SCENES, SHOTS, T } from '../timeline';

const S = T.shop;
const START = SCENES.shop[0];
const PAID = SHOTS.acompanha.from;

// "O cliente escolhe, monta o pedido e paga no Pix, sem criar conta": one real purchase on the
// storefront, from the menu to the Pix code, then the shopper's page as the payment lands.
export const Shop: React.FC<{ t: number }> = ({ t }) => {
  const enter = prog(t, START, 0.45, ease.outExpo);
  const cam = camAt(t, [
    [START, { x: 187, y: 406, z: 0.95, rx: 6, ry: 10 }],
    [S.escolhe - 0.2, { x: 230, y: 330, z: 1.0, ry: 4 }, 0.35],
    [S.monta - 0.1, { x: 187, y: 300, z: 1.1, ry: -4 }, 0.35],
    [S.monta + 0.55, { x: 187, y: 250, z: 1.25, ry: -2 }, 0.3],
    [S.pix, { x: 187, y: 400, z: 1.08, ry: 6 }, 0.35],
    [PAID, { x: 187, y: 470, z: 1.2, ry: 0 }, 0.35],
  ]);
  const shot = t < PAID ? SHOTS.compra : SHOTS.acompanha;
  const noAccount = prog(t, S.sem, 0.35);
  return (
    <AbsoluteFill>
      <Device shot={shot} t={t} width={PHONE} cx={540} cy={1080 + (1 - enter) * 1200} cam={{ ...cam, rx: (cam.rx ?? 0) + (1 - enter) * 35 }}>
        {(s) => t >= PAID && <Ring t={t} at={PAID + 0.25} s={s} x={8} y={440} w={359} h={120} />}
      </Device>
      {t >= S.sem && (
        <Chip p={noAccount} style={{ left: 540, top: 1440, translate: '-50% 0' }}>
          <Check size={46} color={C.forest} p={prog(t, S.sem + 0.1, 0.3)} /> sem criar conta
        </Chip>
      )}
    </AbsoluteFill>
  );
};
