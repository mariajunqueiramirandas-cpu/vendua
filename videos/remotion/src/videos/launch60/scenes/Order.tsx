import { AbsoluteFill, Img, staticFile } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog } from '../../../lib/motion';
import { PHONE, camAt, Check, Device, display, Ring, slam } from '../kit';
import { SCENES, SHOTS, T, timeOf, UI } from '../timeline';

const O = T.order;
const START = SCENES.order[0];
const PAID = timeOf(SHOTS.pedidos, UI.pedidos.marks.pagoVisto);

// The push the admin sends for a new order (title "Pedido #N chegou", body name · total · mode,
// from the app installed as "Minha loja"), drawn over the frame at a size that reads.
const Push: React.FC<{ t: number }> = ({ t }) => {
  const p = prog(t, O.cai, 0.45, ease.outBack);
  const out = prog(t, PAID - 0.4, 0.35, ease.inCubic);
  if (t < O.cai || out >= 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 70,
        right: 70,
        top: 380,
        padding: '30px 34px',
        borderRadius: 46,
        background: 'rgba(244,242,234,0.94)',
        boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
        display: 'flex',
        gap: 28,
        alignItems: 'center',
        transform: `translateY(${(1 - p) * -420 - out * 520}px) scale(${1 + kick(t, O.cai + 0.3, 0.3) * 0.03})`,
      }}
    >
      <Img src={staticFile('brand/mark-avatar.svg')} style={{ width: 104, height: 104, borderRadius: 26, flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0, fontFamily: FONT.body, color: '#17221d' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, fontWeight: 700, color: '#5b6b63', letterSpacing: '0.04em' }}>
          <span>MINHA LOJA</span>
          <span style={{ letterSpacing: 0 }}>agora</span>
        </div>
        <div style={{ fontSize: 44, fontWeight: 800, marginTop: 4 }}>Pedido #44 chegou</div>
        <div style={{ fontSize: 38, fontWeight: 600, color: '#3c4c44', marginTop: 2 }}>Luiz · R$ 90,00 · retirada</div>
      </div>
    </div>
  );
};

// "E o pedido cai prontinho no seu celular. Um toque, e tá aceito!": the real board as the order
// lands, flips to paid, and is accepted with one tap.
export const Order: React.FC<{ t: number }> = ({ t }) => {
  const enter = prog(t, START, 0.45, ease.outExpo);
  const cam = camAt(t, [
    [START, { x: 187, y: 406, z: 0.92, rx: 8, ry: -10 }],
    [O.cai + 0.35, { x: 187, y: 470, z: 1.4, ry: -4 }, 0.45],
    [O.toque + 0.15, { x: 187, y: 560, z: 1.12, ry: 4 }, 0.5],
  ]);
  const ok = prog(t, O.aceito, 0.3, ease.outExpo);
  return (
    <AbsoluteFill>
      <Device shot={SHOTS.pedidos} t={t} width={PHONE} cx={540} cy={1060 + (1 - enter) * 1200} cam={{ ...cam, rx: (cam.rx ?? 0) + (1 - enter) * 35 }}>
        {(s) => <Ring t={t} at={PAID} s={s} x={128} y={438} w={110} h={28} until={O.toque - 0.1} />}
      </Device>
      <Push t={t} />
      {t >= O.aceito && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 1390,
            display: 'flex',
            justifyContent: 'center',
            ...slam(t, O.aceito, 1.5),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '18px 44px 26px 30px', borderRadius: 99, background: C.lime, boxShadow: '0 30px 80px rgba(0,0,0,0.45)' }}>
            <div style={{ width: 96, height: 96, borderRadius: 48, background: C.forest, display: 'grid', placeItems: 'center' }}>
              <Check size={70} color={C.lime} p={ok} />
            </div>
            <span style={{ ...display(120, C.forest) }}>aceito!</span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
