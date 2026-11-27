import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog } from '../../../lib/motion';
import { F, T } from '../timeline';
import { display, Phone, Push, Screen, Words } from '../ui';

// Frames 3 and 4 share one phone (a match cut): "Sua loja online, com a sua cara." on the real Loja
// screen, whose theme turns from Noite to Creme on "cara"; then "Os pedidos caem direto no seu
// celular." on the real Pedidos screen with Core's own notifications for orders #28 and #29.
export const PW = 600;
const PH = Math.round((PW * 1624) / 750);
const LEFT = 540 - (PW + 2 * Math.round(PW * 0.028)) / 2;
const TOP = 610;

const turn = (t: number) => -9 + 3 * Math.sin(t * 1.1);

const Stage: React.FC<{ t: number; enter: number; bump: number; children: React.ReactNode }> = ({ t, enter, bump, children }) => (
  <div style={{ position: 'absolute', inset: 0, perspective: 2200, perspectiveOrigin: '540px 1000px' }}>
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transformStyle: 'preserve-3d',
        transformOrigin: '540px 1200px',
        transform: `translateY(${(1 - enter) * 1100 - bump * 12}px) rotateX(${7 + (1 - enter) * 34}deg) rotateY(${turn(t)}deg) rotateZ(${(1 - enter) * -6}deg)`,
      }}
    >
      <Phone width={PW} glare={turn(t) / 18} style={{ left: LEFT, top: TOP }}>
        {children}
      </Phone>
    </div>
  </div>
);

const Head: React.FC<{ t: number; a: readonly (readonly [string, number])[]; b: readonly (readonly [string, number])[] }> = ({ t, a, b }) => (
  <div style={{ position: 'absolute', left: 72, right: 72, top: 270 }}>
    <Words t={t} words={a} style={display(98, C.cream)} />
    <Words t={t} words={b} style={{ ...display(98, C.lime), marginTop: 6 }} />
  </div>
);

export const Loja: React.FC<{ t: number }> = ({ t }) => {
  const w = F.loja.w;
  const enter = prog(t, T.loja.phone, 0.65, ease.outExpo);
  const url = prog(t, T.loja.url, 0.45, ease.outBack);
  const wipe = prog(t, T.loja.theme, 0.32, ease.inOutCubic);
  return (
    <AbsoluteFill>
      <Head
        t={t}
        a={[['Sua', w.sua], ['loja', w.loja], ['online,', w.online]]}
        b={[['com', w.com], ['a', w.com + 0.14], ['sua', w.com + 0.3], ['cara.', w.cara]]}
      />
      <Stage t={t} enter={enter} bump={kick(t, T.loja.theme + 0.32, 0.3)}>
        <Screen src="screens/loja-noite-750.webp" width={PW} />
        <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 0 ${(1 - wipe) * 100}% 0)` }}>
          <Screen src="screens/loja-creme-750.webp" width={PW} />
        </div>
        {wipe > 0 && wipe < 1 && <div style={{ position: 'absolute', left: 0, right: 0, top: wipe * PH - 3, height: 6, background: C.lime }} />}
      </Stage>
      {url > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 560,
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            transform: `translateY(${(1 - Math.min(1, url)) * 90}px) scale(${0.55 + 0.45 * url})`,
            opacity: Math.min(1, url * 2.5),
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '22px 36px',
              borderRadius: 99,
              background: C.lime,
              color: C.forest,
              fontFamily: FONT.body,
              fontWeight: 800,
              fontSize: 44,
              boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
            }}
          >
            <svg viewBox="0 0 24 24" width={40} height={40} fill="none" stroke={C.forest} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            bolosdanena.vendua.com.br
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

export const Pedidos: React.FC<{ t: number }> = ({ t }) => {
  const w = F.pedidos.w;
  const swap = prog(t, T.pedidos.phone, 0.22, ease.outCubic);
  const [p1, p2] = T.pedidos.push;
  const in1 = prog(t, p1, 0.38, ease.outExpo);
  const in2 = prog(t, p2, 0.38, ease.outExpo);
  const push2 = prog(t, p2, 0.32, ease.outCubic);
  const bump = Math.max(kick(t, p1, 0.25), kick(t, p2, 0.25), kick(t, T.pedidos.badge, 0.3));
  return (
    <AbsoluteFill>
      <Head
        t={t}
        a={[['Os', w.os], ['pedidos', w.pedidos], ['caem', w.caem]]}
        b={[['direto', w.direto], ['no', w.no], ['seu', w.no + 0.12], ['celular.', w.celular]]}
      />
      <Stage t={t} enter={1} bump={bump}>
        <Screen src="screens/loja-creme-750.webp" width={PW} style={{ transform: `translateX(${-swap * 30}%)`, opacity: 1 - swap }} />
        <Screen src="screens/pedidos-noite-750.webp" width={PW} style={{ transform: `translateX(${(1 - swap) * 100}%)` }} />
      </Stage>
      {in1 > 0 && (
        <Push
          n={28}
          who="Mariana"
          total="R$ 85,00"
          style={{
            left: 150,
            top: 560 + push2 * 196,
            transform: `translateY(${(1 - in1) * -260}px) scale(${1 - push2 * 0.04})`,
            opacity: Math.min(1, in1 * 2) * (1 - push2 * 0.15),
          }}
        />
      )}
      {in2 > 0 && (
        <Push n={29} who="Luiz" total="R$ 219,00" style={{ left: 150, top: 560, transform: `translateY(${(1 - in2) * -260}px)`, opacity: Math.min(1, in2 * 2) }} />
      )}
    </AbsoluteFill>
  );
};
