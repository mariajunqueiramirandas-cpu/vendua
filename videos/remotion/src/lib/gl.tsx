import { useLayoutEffect, useRef, type CSSProperties } from 'react';

// A fragment shader on a full-frame canvas, redrawn synchronously on every render so Remotion's
// screenshot always holds the current frame. `scale` < 1 renders smaller and lets CSS stretch it:
// smooth fields don't need every pixel, and software GL (no GPU in CI) pays per pixel.
export type Uniforms = Record<string, number | readonly number[]>;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const HEADER = `#version 300 es
precision highp float;
uniform vec2 uRes;
out vec4 outColor;
`;

const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
};

export const program = (gl: WebGL2RenderingContext, vert: string, frag: string) => {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
};

export const setUniforms = (gl: WebGL2RenderingContext, p: WebGLProgram, u: Uniforms) => {
  for (const [name, v] of Object.entries(u)) {
    const loc = gl.getUniformLocation(p, name);
    if (!loc) continue;
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v.length === 2) gl.uniform2fv(loc, v as number[]);
    else if (v.length === 3) gl.uniform3fv(loc, v as number[]);
    else gl.uniform4fv(loc, v as number[]);
  }
};

export const glContext = (canvas: HTMLCanvasElement) => {
  const gl = canvas.getContext('webgl2', {
    preserveDrawingBuffer: true,
    premultipliedAlpha: true,
    antialias: false,
  });
  if (!gl) throw new Error('WebGL2 unavailable');
  return gl;
};

/** Free the context on unmount: Chromium keeps ~16 live and drops the oldest past that. */
export const releaseGL = (gl: WebGL2RenderingContext | null) =>
  gl?.getExtension('WEBGL_lose_context')?.loseContext();

export const Shader: React.FC<{
  frag: string;
  uniforms: Uniforms;
  width: number;
  height: number;
  scale?: number;
  style?: CSSProperties;
}> = ({ frag, uniforms, width, height, scale = 1, style }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef<{ gl: WebGL2RenderingContext; p: WebGLProgram } | null>(null);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  useLayoutEffect(() => {
    const gl = glContext(ref.current!);
    st.current = { gl, p: program(gl, VERT, frag) };
    return () => {
      releaseGL(gl);
      st.current = null;
    };
  }, [frag]);

  useLayoutEffect(() => {
    const s = st.current;
    if (!s) return;
    const { gl, p } = s;
    gl.viewport(0, 0, w, h);
    gl.useProgram(p);
    setUniforms(gl, p, { ...uniforms, uRes: [w, h] });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });

  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      style={{ position: 'absolute', left: 0, top: 0, width, height, ...style }}
    />
  );
};
