import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import '../../lib/fonts';
import { C } from '../../lib/brand';
import { Grain } from '../../lib/grain';
import { kick, shake } from '../../lib/motion';
import { Brand } from './scenes/Brand';
import { Dua } from './scenes/Dua';
import { Hook } from './scenes/Hook';
import { Comissao, Launch } from './scenes/Launch';
import { Cta, Desconto } from './scenes/Offer';
import { Loja, Pedidos } from './scenes/Shop';
import { DROP, F, G, HITS, type FrameId } from './timeline';

// The Black Friday launch reel: ~27 s, 9:16, narrated (VOICE.md). One frame per narrator line; the
// picture is flat and graphic (night, lime, real admin screens), no generative backdrop.
const SEQ: [FrameId, React.FC<{ t: number }>][] = [
  ['hook', Hook],
  ['brand', Brand],
  ['loja', Loja],
  ['pedidos', Pedidos],
  ['dua', Dua],
  ['comissao', Comissao],
  ['launch', Launch],
  ['desconto', Desconto],
  ['cta', Cta],
];

export const BlackFriday: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / G.fps;
  const big = kick(t, DROP, 0.2);
  const s = shake(t, HITS, 7 + 12 * big, 0.3);
  // a slow push inside each frame keeps holds alive; it resets on every cut
  const id = SEQ.find(([k]) => t >= F[k].start && t < F[k].end)?.[0] ?? 'cta';
  const push = 1 + 0.012 * (t - F[id].start);

  return (
    <AbsoluteFill style={{ background: C.night, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: `radial-gradient(1100px 900px at 50% 40%, ${C.forestDeep} 0%, ${C.night} 75%)` }} />
      <AbsoluteFill style={{ transform: `translate(${s.x}px, ${s.y}px) rotate(${s.r}deg) scale(${push})` }}>
        {SEQ.map(([k, Scene]) => (
          <Sequence key={k} name={k} from={G.f(F[k].start)} durationInFrames={G.f(F[k].end) - G.f(F[k].start)}>
            <Scene t={t} />
          </Sequence>
        ))}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 45%, transparent 60%, rgba(0,0,0,0.32) 100%)', pointerEvents: 'none' }} />
      <Grain frame={frame} opacity={0.06} />
      <Audio src={staticFile('blackfriday/score.wav')} />
    </AbsoluteFill>
  );
};
