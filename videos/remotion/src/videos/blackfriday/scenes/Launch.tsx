import { AbsoluteFill } from 'remotion';
import { C } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { DROP, F, GAP, T } from '../timeline';
import { display, label, Tape, Words } from '../ui';

const slam = (t: number, at: number, from = 1.5) => {
  const p = prog(t, at - 0.02, 0.26, ease.outExpo);
  return { transform: `scale(${from - (from - 1) * p})`, filter: `blur(${(1 - p) * 14}px)`, opacity: t >= at - 0.02 ? Math.min(1, p * 3) : 0 };
};

// "Zero comissão por pedido!" — the build: 0% lands, a lime line draws across with the riser, and
// the beat before the drop is empty night.
export const Comissao: React.FC<{ t: number }> = ({ t }) => {
  const w = F.comissao.w;
  if (t >= GAP) return null;
  const zoom = tw(t, F.comissao.start, GAP, 1, 1.07, ease.inCubic);
  const line = tw(t, T.comissao.rise, GAP, 0, 1, ease.inCubic);
  return (
    <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
      <div style={{ position: 'absolute', top: 470, width: '100%', textAlign: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'flex-start', ...display(470, C.lime), letterSpacing: '-0.06em', ...slam(t, w.zero, 1.35) }}>
          0<span style={{ fontSize: '0.5em', marginTop: '0.18em', marginLeft: '0.04em' }}>%</span>
        </span>
      </div>
      <div style={{ position: 'absolute', top: 1000, width: '100%', display: 'grid', justifyItems: 'center' }}>
        <Words t={t} words={[['de', w.comissao - 0.1], ['comissão', w.comissao]]} style={display(112, C.cream)} />
        <Words t={t} words={[['por', w.por], ['pedido.', w.pedido]]} style={{ ...display(112, C.muted), marginTop: 8 }} />
      </div>
      <div style={{ position: 'absolute', left: 72, top: 1330, height: 10, borderRadius: 5, width: 936 * line, background: C.lime, opacity: 0.9 }} />
    </AbsoluteFill>
  );
};

// "Lançamento oficial na Black Friday: sexta, dia 27," — the drop: the frame turns lime (once, and
// holds), two tapes run across, BLACK / FRIDAY slam on the words and a calendar leaf shows the 27th.
export const Launch: React.FC<{ t: number }> = ({ t }) => {
  const w = F.launch.w;
  const L = T.launch;
  const since = t - DROP;
  const punch = prog(t, DROP, 0.5, ease.outExpo);
  const leaf = tw(t, L.card - 0.04, L.card + 0.4, 0, 1, ease.outBack);
  const d27 = kick(t, L.d27, 0.35);
  return (
    <AbsoluteFill style={{ background: C.lime }}>
      <AbsoluteFill style={{ transform: `scale(${1.08 - 0.08 * punch})` }}>
        <Tape text="Black Friday" x={-300 - since * 240} top={235} rotate={-6} bg={C.night} fg={C.lime} reveal={prog(t, DROP, 0.3, ease.outCubic)} />
        <Tape text="Lançamento oficial" x={-1500 + since * 240} top={1505} rotate={4} bg={C.forest} fg={C.cream} reveal={prog(t, DROP + 0.08, 0.3, ease.outCubic)} />
        <div style={{ position: 'absolute', top: 455, width: '100%', display: 'grid', justifyItems: 'center' }}>
          <Words t={t} words={[['Lançamento', w.lancamento], ['oficial', w.oficial]]} style={{ ...label(50, C.forest), letterSpacing: '0.16em' }} />
        </div>
        {/* the words wait in outline from the drop and fill solid as they are said */}
        <div style={{ position: 'absolute', top: 540, width: '100%', textAlign: 'center', ...display(262, 'transparent'), letterSpacing: '-0.055em', lineHeight: 0.9 }}>
          {(['BLACK', 'FRIDAY'] as const).map((word, i) => (
            <div key={word} style={{ position: 'relative' }}>
              <div style={{ WebkitTextStroke: `4px ${C.night}`, opacity: 0.55 * prog(t, DROP + i * 0.06, 0.3, ease.outCubic) }}>{word}</div>
              <div style={{ position: 'absolute', inset: 0, color: C.night, ...slam(t, i ? L.friday : L.black) }}>{word}</div>
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', inset: 0, perspective: 1400, perspectiveOrigin: '540px 1100px' }}>
          <div
            style={{
              position: 'absolute',
              left: 540 - 190,
              top: 1060,
              width: 380,
              height: 390,
              borderRadius: 40,
              background: C.night,
              boxShadow: '0 30px 60px rgba(13,42,35,0.35)',
              overflow: 'hidden',
              transformOrigin: '50% 0%',
              transform: `rotateX(${(1 - leaf) * -100}deg) rotate(${-3 + d27 * 2}deg)`,
              opacity: t >= L.card - 0.04 ? 1 : 0,
              textAlign: 'center',
            }}
          >
            <div style={{ height: 78, background: C.forest, display: 'grid', placeItems: 'center', ...label(34, C.lime), letterSpacing: '0.2em' }}>sexta-feira</div>
            <div style={{ ...display(210, C.cream), lineHeight: 1.05, marginTop: 8, ...slam(t, L.d27, 1.6) }}>27</div>
            <div style={{ ...label(30, C.muted), letterSpacing: '0.24em', marginTop: -6 }}>novembro</div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
