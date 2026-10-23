import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { Rise, split } from '../../../lib/text';
import { display, slam } from '../kit';
import { COUNT, SCENES, T, VO } from '../timeline';

const P = T.price;
const END = SCENES.price[1];
const BRAND = VO.price.words.find((w) => w.w.startsWith('Venduá'))!.t0;
const brl = (cents: number) => `R$ ${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;

// "Nenhuma taxa da Venduá por pedido. Planos a partir de R$ 69,90 por mês." (content.ts: Mirim
// R$ 69,90, Bandeira R$ 169; no fee per order)
export const Price: React.FC<{ t: number }> = ({ t }) => {
  const swap = prog(t, P.planos - 0.15, 0.3, ease.inCubic);
  const cents = Math.round(tw(t, COUNT[0], COUNT[1], 0, 6990, ease.outCubic));
  const landed = t >= COUNT[1];
  const out = prog(t, END - 0.25, 0.25, ease.inCubic);
  return (
    <AbsoluteFill>
      {swap < 1 && (
        <div style={{ position: 'absolute', left: 72, right: 72, top: 280, transform: `translateY(${-swap * 500}px)`, opacity: 1 - swap }}>
          <div style={{ ...display(170, C.lime), transformOrigin: '0% 100%', ...slam(t, P.nenhuma) }}>Nenhuma</div>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <div style={{ ...display(270, C.cream), transformOrigin: '0% 100%', textShadow: split(kick(t, P.taxa, 0.35), 14), ...slam(t, P.taxa) }}>taxa</div>
          </div>
          <div style={{ ...display(124, C.cream), marginTop: 14 }}>
            <Rise p={prog(t, P.por, 0.3, ease.outExpo)}>por pedido.</Rise>
          </div>
          <div
            style={{
              marginTop: 70,
              padding: '34px 40px',
              borderRadius: 40,
              background: C.surface,
              fontFamily: FONT.body,
              color: '#17221d',
              boxShadow: '0 40px 90px rgba(0,0,0,0.45)',
              transform: `translateY(${(1 - prog(t, BRAND, 0.4, ease.outExpo)) * 900}px) rotate(-1.5deg)`,
              opacity: t >= BRAND ? 1 : 0,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 46, fontWeight: 700 }}>
              <span>Pedido #44</span>
              <span>R$ 90,00</span>
            </div>
            <div style={{ height: 2, background: '#e3e0d6', margin: '24px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 46, fontWeight: 700 }}>
              <span style={{ color: '#4d6159' }}>Taxa da Venduá</span>
              <span
                style={{
                  padding: '6px 22px 10px',
                  borderRadius: 18,
                  background: C.lime,
                  color: C.forest,
                  fontWeight: 900,
                  ...slam(t, P.por + 0.15, 1.8),
                }}
              >
                R$ 0,00
              </span>
            </div>
          </div>
        </div>
      )}
      {t >= P.planos - 0.1 && (
        <div style={{ position: 'absolute', left: 72, right: 72, top: 340, transform: `translateY(${-out * 300}px)`, opacity: 1 - out }}>
          <div style={{ ...display(104, C.cream) }}>
            <Rise p={prog(t, P.planos, 0.3, ease.outExpo)}>Planos</Rise>{' '}
            <Rise p={prog(t, P.partir, 0.3, ease.outExpo)}>a partir de</Rise>
          </div>
          <div
            style={{
              ...display(228, C.lime),
              marginTop: 30,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              transformOrigin: '0% 100%',
              transform: `scale(${(0.7 + 0.3 * prog(t, P.partir, 0.3, ease.outBack)) * (1 + kick(t, COUNT[1], 0.35) * 0.08)})`,
              opacity: t >= P.partir ? 1 : 0,
              textShadow: landed ? `0 0 ${60 * kick(t, COUNT[1], 0.5)}px rgba(217,248,117,0.8)` : 'none',
            }}
          >
            {brl(cents)}
          </div>
          <div style={{ ...display(120, C.cream), marginTop: 10 }}>
            <Rise p={prog(t, P.mes, 0.3, ease.outExpo)}>por mês</Rise>
          </div>
          <div style={{ marginTop: 70, display: 'flex', flexDirection: 'column', gap: 22, alignItems: 'flex-start' }}>
            <div
              style={{
                padding: '16px 34px 20px',
                borderRadius: 99,
                background: C.cream,
                color: C.forest,
                fontFamily: FONT.body,
                fontWeight: 800,
                fontSize: 48,
                transformOrigin: '0% 50%',
                transform: `scale(${tw(t, COUNT[1], COUNT[1] + 0.3, 0, 1, ease.outBack)})`,
              }}
            >
              Venduá Mirim · R$ 69,90/mês
            </div>
            <div
              style={{
                padding: '16px 34px 20px',
                borderRadius: 99,
                border: `4px solid ${C.lime}`,
                color: C.lime,
                fontFamily: FONT.body,
                fontWeight: 800,
                fontSize: 48,
                transformOrigin: '0% 50%',
                transform: `scale(${tw(t, P.mes + 0.2, P.mes + 0.5, 0, 1, ease.outBack)})`,
              }}
            >
              Bandeira, com o Duá · R$ 169/mês
            </div>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
