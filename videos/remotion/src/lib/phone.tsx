import type { CSSProperties, ReactNode } from 'react';
import { Img, staticFile } from 'remotion';

// A phone drawn in CSS around a real admin capture (750×1624). Transform it in 3D from outside;
// `glare` (−1…1) slides the screen's reflection with the phone's turn.
export const Phone: React.FC<{
  src: string;
  width: number;
  glare?: number;
  style?: CSSProperties;
  children?: ReactNode;
}> = ({ src, width, glare = 0, style, children }) => {
  const h = Math.round((width * 1624) / 750);
  const bezel = Math.round(width * 0.028);
  return (
    <div
      style={{
        position: 'absolute',
        width: width + bezel * 2,
        height: h + bezel * 2,
        borderRadius: width * 0.14,
        background: 'linear-gradient(145deg, #2a332f, #050806 40%, #1a211e)',
        padding: bezel,
        boxShadow: '0 60px 120px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(255,255,255,0.08)',
        transformStyle: 'preserve-3d',
        ...style,
      }}
    >
      <div style={{ position: 'relative', width, height: h, borderRadius: width * 0.115, overflow: 'hidden', background: '#000' }}>
        <Img src={staticFile(src)} style={{ width, height: h, display: 'block' }} />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(115deg, transparent ${30 + glare * 30}%, rgba(255,255,255,0.13) ${42 + glare * 30}%, transparent ${55 + glare * 30}%)`,
          }}
        />
      </div>
      {children}
    </div>
  );
};
