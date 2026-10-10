import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import { fontsReady } from './fonts';
import { glContext, program, releaseGL, setUniforms } from './gl';
import { rng } from './random';

// Text made of particles: a swirling cloud that converges into the glyphs (p 0 → 1) and blows
// out towards the camera (e 0 → 1). Targets are sampled from the text drawn on a 2D canvas once
// the fonts are in; everything after that runs in the vertex shader from the uniforms.
const VERT = `#version 300 es
in vec2 aTarget; in vec3 aStart; in float aSeed; in float aCol;
uniform vec2 uRes, uCenter;
uniform float uP, uE, uT, uSpin, uSize;
uniform vec3 uC0, uC1;
out vec3 vCol; out float vA;
void main() {
  float a = uSpin * (1.0 - uP);
  vec2 s = mat2(cos(a), -sin(a), sin(a), cos(a)) * aStart.xy;
  vec3 start = vec3(s + uCenter, aStart.z);
  vec3 target = vec3(aTarget, 0.0);
  float p = clamp((uP - aSeed * 0.3) / 0.7, 0.0, 1.0);
  p = 1.0 - pow(1.0 - p, 4.0);
  vec3 pos = mix(start, target, p);
  pos.xy += vec2(sin(uT * 3.1 + aSeed * 40.0), cos(uT * 2.7 + aSeed * 31.0)) * 1.4 * p;
  vec2 dir = normalize(target.xy - uCenter + vec2(aSeed - 0.5, fract(aSeed * 7.0) - 0.5) * 160.0);
  float e = uE * uE;
  pos.xy += dir * e * (700.0 + aSeed * 1100.0);
  pos.z += e * (500.0 + aSeed * 1300.0);
  float f = 1600.0 / max(1600.0 - pos.z, 80.0);
  vec2 sp = uCenter + (pos.xy - uCenter) * f;
  gl_Position = vec4(sp.x / uRes.x * 2.0 - 1.0, 1.0 - sp.y / uRes.y * 2.0, 0.0, 1.0);
  gl_PointSize = uSize * f * (0.7 + 0.6 * fract(aSeed * 13.0));
  vCol = mix(uC0, uC1, aCol);
  vA = (1.0 - smoothstep(0.75, 1.0, uE)) * (0.55 + 0.45 * p);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vCol; in float vA;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d) * vA;
  outColor = vec4(vCol * a, a);
}`;

type Data = { target: Float32Array; start: Float32Array; seed: Float32Array; col: Float32Array; n: number };

const sample = (text: string, font: string, w: number, h: number, cx: number, cy: number, count: number, seed: number): Data => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, cx, cy);
  const px = ctx.getImageData(0, 0, w, h).data;
  const pts: number[] = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (px[(y * w + x) * 4 + 3] > 140) pts.push(x, y);
  const r = rng(seed);
  const target = new Float32Array(count * 2);
  const start = new Float32Array(count * 3);
  const sd = new Float32Array(count);
  const col = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const k = Math.floor(r() * (pts.length / 2)) * 2;
    target[i * 2] = pts[k] + (r() - 0.5) * 1.5;
    target[i * 2 + 1] = pts[k + 1] + (r() - 0.5) * 1.5;
    // a flat galaxy: two arms, denser near the middle
    const rad = 120 + r() ** 0.7 * 1000;
    const ang = (i % 2) * Math.PI + rad * 0.006 + (r() - 0.5) * 0.9;
    start[i * 3] = Math.cos(ang) * rad;
    start[i * 3 + 1] = Math.sin(ang) * rad * 0.8;
    start[i * 3 + 2] = (r() - 0.5) * 900;
    sd[i] = r();
    col[i] = r() < 0.22 ? 1 : 0;
  }
  return { target, start, seed: sd, col, n: count };
};

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export const ParticleText: React.FC<{
  text: string;
  font: string;
  width: number;
  height: number;
  center: [number, number];
  count: number;
  colors: [string, string];
  p: number;
  e: number;
  t: number;
  spin?: number;
  size?: number;
  seed?: number;
}> = ({ text, font, width, height, center, count, colors, p, e, t, spin = 4, size = 3.2, seed = 11 }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<Data | null>(null);
  const st = useRef<{ gl: WebGL2RenderingContext; prog: WebGLProgram } | null>(null);

  useEffect(() => {
    const handle = delayRender('particle targets');
    fontsReady
      .then(() => document.fonts.load(font))
      .then(() => {
        setData(sample(text, font, width, height, center[0], center[1], count, seed));
        continueRender(handle);
      });
  }, [text, font, width, height, count, seed]);

  useLayoutEffect(() => {
    if (!data) return;
    const gl = glContext(ref.current!);
    const prog = program(gl, VERT, FRAG);
    gl.useProgram(prog);
    const attr = (name: string, arr: Float32Array, size: number) => {
      const loc = gl.getAttribLocation(prog, name);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr('aTarget', data.target, 2);
    attr('aStart', data.start, 3);
    attr('aSeed', data.seed, 1);
    attr('aCol', data.col, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    st.current = { gl, prog };
    return () => {
      releaseGL(gl);
      st.current = null;
    };
  }, [data]);

  useLayoutEffect(() => {
    const s = st.current;
    if (!s || !data) return;
    const { gl, prog } = s;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    setUniforms(gl, prog, {
      uRes: [width, height],
      uCenter: center,
      uP: p,
      uE: e,
      uT: t,
      uSpin: spin,
      uSize: size,
      uC0: hex(colors[0]),
      uC1: hex(colors[1]),
    });
    gl.drawArrays(gl.POINTS, 0, data.n);
  });

  return <canvas ref={ref} width={width} height={height} style={{ position: 'absolute', left: 0, top: 0, width, height }} />;
};
