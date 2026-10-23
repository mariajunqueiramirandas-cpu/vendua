import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { Rise } from '../../../lib/text';
import { display } from '../kit';
import { E, SCENES, T } from '../timeline';

const P = T.pain;
const END = SCENES.pain[1];
const INK = '#23407a';

const Title: React.FC<{ t: number; at: number; children: React.ReactNode }> = ({ t, at, children }) => (
  <div style={{ position: 'absolute', left: 64, right: 64, top: 250, ...display(112, C.cream), lineHeight: 1, textShadow: '0 10px 40px rgba(0,0,0,0.6)' }}>
    <Rise p={prog(t, at, 0.3, ease.outExpo)}>{children}</Rise>
  </div>
);

// 1 · "Cliente esperando": a shopper's messages with no answer, and the wait counting up.
const Waiting: React.FC<{ t: number }> = ({ t }) => {
  const msgs = [
    ['Oi, boa tarde!', '14:02'],
    ['Tem bolo de cenoura pra hoje?', '14:09'],
    ['Oi??', '14:31'],
    ['Alô?', '14:46'],
  ];
  const wait = Math.round(tw(t, P.cliente, P.cliente + 4 * E, 0, 44, ease.outCubic));
  return (
    <>
      <Title t={t} at={P.cliente}>
        Cliente esperando,
      </Title>
      <div style={{ position: 'absolute', left: 110, right: 110, top: 520, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {msgs.map(([m, h], i) => {
          const at = P.cliente + i * E;
          const p = prog(t, at, 0.22, ease.outBack);
          return t < at ? null : (
            <div
              key={i}
              style={{
                alignSelf: 'flex-start',
                maxWidth: '86%',
                padding: '20px 28px 14px',
                borderRadius: 34,
                borderTopLeftRadius: 8,
                background: C.surface,
                fontFamily: FONT.body,
                fontWeight: 600,
                fontSize: 46,
                color: '#17221d',
                boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
                transformOrigin: '0% 0%',
                transform: `scale(${0.6 + 0.4 * p})`,
                opacity: Math.min(1, p * 3),
              }}
            >
              {m}
              <div style={{ textAlign: 'right', fontSize: 26, color: '#6d7d75', marginTop: 2 }}>{h}</div>
            </div>
          );
        })}
      </div>
      {t >= P.cliente + 3 * E && (
        <div
          style={{
            position: 'absolute',
            left: 110,
            top: 1260,
            padding: '18px 34px',
            borderRadius: 99,
            background: '#ff4d2e',
            color: '#fff',
            fontFamily: FONT.body,
            fontWeight: 800,
            fontSize: 50,
            fontVariantNumeric: 'tabular-nums',
            transform: `scale(${0.5 + 0.5 * prog(t, P.cliente + 3 * E, 0.25, ease.outBack)})`,
            transformOrigin: '0% 50%',
          }}
        >
          sem resposta há {wait} min
        </div>
      )}
    </>
  );
};

// 2 · "pedido no caderno": orders scribbled in a notebook, one crossed out, one circled.
const Notebook: React.FC<{ t: number }> = ({ t }) => {
  const lines: [string, number, boolean?][] = [
    ['Ana · 2 bolos cenoura · 17h', P.caderno + 0.02],
    ['Carla · milho + fatia · pix?', P.caderno + 0.24],
    ['Bruno · chocolate', P.caderno + 0.46, true],
    ['Rafa · entrega Centro ???', P.caderno + 0.7],
  ];
  const enter = prog(t, P.caderno - 0.05, 0.35, ease.outExpo);
  return (
    <>
      <Title t={t} at={P.caderno}>
        pedido no caderno,
      </Title>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 520,
          width: 840,
          height: 820,
          borderRadius: 18,
          background: `repeating-linear-gradient(#f8f3e4 0 92px, #b9c9e6 92px 95px)`,
          backgroundPosition: '0 70px',
          boxShadow: '0 40px 90px rgba(0,0,0,0.5)',
          transform: `rotate(${-3 + (1 - enter) * -12}deg) translateY(${(1 - enter) * 600}px)`,
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', left: 96, top: 0, bottom: 0, width: 4, background: '#e58b8b' }} />
        {lines.map(([text, at, crossed], i) => {
          const w = prog(t, at, 0.3, ease.linear);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 124,
                top: 104 + i * 190,
                fontFamily: FONT.body,
                fontStyle: 'italic',
                fontWeight: 600,
                fontSize: 52,
                color: INK,
                whiteSpace: 'nowrap',
                clipPath: `inset(-20px ${100 - w * 100}% -20px -10px)`,
                transform: `rotate(${(i % 2 ? 1 : -1) * 1.2}deg)`,
              }}
            >
              {text}
              {crossed && (
                <div
                  style={{
                    position: 'absolute',
                    left: -10,
                    right: -10,
                    top: '52%',
                    height: 7,
                    background: INK,
                    transformOrigin: '0 50%',
                    transform: `scaleX(${prog(t, at + 0.25, 0.15)})`,
                  }}
                />
              )}
            </div>
          );
        })}
        <svg viewBox="0 0 300 140" style={{ position: 'absolute', left: 540, top: 250, width: 300, height: 140, overflow: 'visible' }}>
          <path
            d="M150 16 C 60 10, 10 50, 30 90 C 50 130, 250 132, 280 80 C 300 40, 200 6, 120 22"
            fill="none"
            stroke="#c8372a"
            strokeWidth={8}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - prog(t, P.caderno + 0.45, 0.32)}
          />
        </svg>
      </div>
    </>
  );
};

// 3 · "Pix conferido no print": a shopper's receipt, squinted at, then captured as a screenshot.
const Receipt: React.FC<{ t: number }> = ({ t }) => {
  const enter = prog(t, P.pix - 0.02, 0.35, ease.outExpo);
  const shot = prog(t, P.print, 0.4, ease.inOutCubic);
  const lens = tw(t, P.pix + 0.2, P.print - 0.05, 0, 1, ease.inOutCubic);
  const rows: [string, string][] = [
    ['Valor', 'R$ 90,00'],
    ['Para', 'Bolos da Nena'],
    ['Data', '23/10 · 14:32'],
  ];
  return (
    <>
      <Title t={t} at={P.pix}>
        Pix conferido no print…
      </Title>
      <div
        style={{
          position: 'absolute',
          left: 170,
          top: 560,
          width: 740,
          height: 860,
          borderRadius: 40,
          background: '#fff',
          border: `${shot * 14}px solid #fff`,
          boxShadow: '0 40px 90px rgba(0,0,0,0.5)',
          transformOrigin: '0% 100%',
          transform: `translateY(${(1 - enter) * 700}px) rotate(${2 - shot * 6}deg) scale(${1 - shot * 0.55}) translate(${-shot * 120}px, ${shot * 180}px)`,
          fontFamily: FONT.body,
          color: '#17221d',
          padding: 56,
          overflow: 'hidden',
        }}
      >
        <div style={{ width: 110, height: 110, borderRadius: 55, background: '#32bcad', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 900, fontSize: 58 }}>✓</div>
        <div style={{ fontWeight: 800, fontSize: 54, marginTop: 34 }}>Pix enviado</div>
        <div style={{ fontWeight: 800, fontSize: 104, letterSpacing: '-0.03em', marginTop: 10 }}>R$ 90,00</div>
        <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 40, borderTop: '2px solid #e8e8e4', paddingTop: 22 }}>
              <span style={{ color: '#6d7d75', fontWeight: 600 }}>{k}</span>
              <span style={{ fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      {t < P.print && (
        <div
          style={{
            position: 'absolute',
            left: 250 + lens * 330,
            top: 760 + Math.sin(lens * Math.PI) * -40 + lens * 160,
            width: 230,
            height: 230,
            borderRadius: 115,
            border: `16px solid ${C.cream}`,
            background: 'rgba(217,248,117,0.12)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
            opacity: enter,
          }}
        >
          <div style={{ position: 'absolute', left: 190, top: 190, width: 26, height: 120, borderRadius: 13, background: C.cream, transform: 'rotate(-45deg)', transformOrigin: '50% 0' }} />
        </div>
      )}
      {t >= P.print && (
        <div style={{ position: 'absolute', left: 560, top: 1050, ...display(260, C.lime), transform: `scale(${0.6 + 0.4 * prog(t, P.print + 0.1, 0.3, ease.outBack)})`, opacity: prog(t, P.print + 0.1, 0.1) }}>
          ?
        </div>
      )}
      <AbsoluteFill style={{ background: '#fff', opacity: kick(t, P.print, 0.22) * 0.85 }} />
    </>
  );
};

// "Cliente esperando, pedido no caderno, Pix conferido no print…": three hard cuts on the words.
export const Pain: React.FC<{ t: number }> = ({ t }) => {
  const fade = prog(t, END - 0.25, 0.25, ease.inCubic);
  return (
    <AbsoluteFill style={{ filter: fade ? `brightness(${1 - fade * 0.7}) blur(${fade * 10}px)` : 'none' }}>
      {t < P.caderno ? <Waiting t={t} /> : t < P.pix ? <Notebook t={t} /> : <Receipt t={t} />}
    </AbsoluteFill>
  );
};
