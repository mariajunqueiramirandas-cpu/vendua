import { useMemo } from 'react';
import { AbsoluteFill } from 'remotion';
import { rng } from './random';

// Film grain: one seeded noise tile, shifted every frame. Far cheaper than an SVG turbulence
// filter over the full frame, and it keeps flat colour fields from banding in the H.264 encode.
export const Grain: React.FC<{ frame: number; opacity?: number }> = ({ frame, opacity = 0.07 }) => {
  const tile = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(256, 256);
    const r = rng(7);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = r() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }, []);
  const r = rng(frame + 1);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${tile})`,
        backgroundPosition: `${Math.floor(r() * 256)}px ${Math.floor(r() * 256)}px`,
        mixBlendMode: 'overlay',
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
};
