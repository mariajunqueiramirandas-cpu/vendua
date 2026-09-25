const VERT = `#version 300 es
void main(){vec2 v=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(v*2.-1.,0.,1.);}`;

// shared fragment prelude — compose as FRAG_HEAD + extra uniforms + NOISE_GLSL + main()
export const FRAG_HEAD = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_dark;
out vec4 O;
`;

export const NOISE_GLSL = `
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
vec2 h22(vec2 p){
  p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));
  return -1.+2.*fract(sin(p)*43758.5453123);
}
float n2(vec2 p){
  vec2 i=floor(p),f=fract(p);
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(dot(h22(i),f),dot(h22(i+vec2(1,0)),f-vec2(1,0)),u.x),
             mix(dot(h22(i+vec2(0,1)),f-vec2(0,1)),dot(h22(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y);
}
float fbm(vec2 p,int oct){
  float v=0.,a=.55;
  for(int i=0;i<8;i++){if(i>=oct)break;v+=a*n2(p);p=p*2.03+vec2(1.7,-1.2);a*=.5;}
  return v;
}
`;

export type FrameState = { t: number; dt: number; mx: number; my: number; hov: number };

export type ShaderCanvasOptions = {
  canvas: HTMLCanvasElement;
  frag: string;
  /** Fraction of CSS pixels rendered into the drawing buffer (default 0.6). */
  resScale?: number;
  /** Frozen u_time used for the static prefers-reduced-motion frame (default 14s). */
  stillTime?: number;
  /** 'window' = viewport coords; 'local' = canvas-relative + drives u_hover. */
  pointer?: 'window' | 'local';
  /** Runs every drawn frame — for uniforms that animate (u_open, u_hover…). */
  bindUniforms?: (
    gl: WebGL2RenderingContext,
    u: (name: string) => WebGLUniformLocation | null,
    s: FrameState,
  ) => void;
  /** Runs once after (re)link — for uniforms that never change (u_mode). */
  bindStatic?: (
    gl: WebGL2RenderingContext,
    u: (name: string) => WebGLUniformLocation | null,
  ) => void;
};

// frame-rate independent exponential easing; lambda ~ -60*ln(1-k) for per-frame factor k @60fps
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  target + (current - target) * Math.exp(-lambda * dt);

const DEFAULT_RES_SCALE = 0.6;
const DEFAULT_STILL_TIME = 14;
const DPR_CAP = 1.5;
const MAX_DT = 0.1;
const MOUSE_LAMBDA = 3.1; // ≈0.05/frame at 60fps
const HOVER_LAMBDA = 5.0; // ≈0.08/frame at 60fps
const STILL_DT = 30; // large dt: easings inside bindUniforms render fully settled

export function mountShaderCanvas(options: ShaderCanvasOptions): (() => void) | null {
  const {
    canvas: cv,
    frag,
    resScale = DEFAULT_RES_SCALE,
    stillTime = DEFAULT_STILL_TIME,
    pointer = 'window',
    bindUniforms,
    bindStatic,
  } = options;
  const gl = cv.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    alpha: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;
  const loseContext = () => gl.getExtension('WEBGL_lose_context')?.loseContext();

  let prog: WebGLProgram | null = null;
  let uRes: WebGLUniformLocation | null = null;
  let uTime: WebGLUniformLocation | null = null;
  let uMouse: WebGLUniformLocation | null = null;
  let uHov: WebGLUniformLocation | null = null;
  let uDark: WebGLUniformLocation | null = null;
  const extra = new Map<string, WebGLUniformLocation | null>();
  const u = (n: string) => {
    if (!extra.has(n)) extra.set(n, prog ? gl.getUniformLocation(prog, n) : null);
    return extra.get(n) ?? null;
  };

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
    console.error('[vnd gl] shader compile failed:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  };
  const setup = () => {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      if (prog) gl.deleteProgram(prog);
      prog = null;
      return false;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs); // attached: freed with the program
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[vnd gl] program link failed:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      prog = null;
      return false;
    }
    gl.useProgram(prog);
    extra.clear();
    uRes = gl.getUniformLocation(prog, 'u_res');
    uTime = gl.getUniformLocation(prog, 'u_time');
    uMouse = gl.getUniformLocation(prog, 'u_mouse');
    uHov = gl.getUniformLocation(prog, 'u_hover');
    uDark = gl.getUniformLocation(prog, 'u_dark');
    bindStatic?.(gl, u);
    return true;
  };
  if (!setup()) {
    loseContext(); // release the context the .failed fallback leaves behind
    return null;
  }

  const state: FrameState = { t: 0, dt: 0, mx: 0, my: 0, hov: 0 };
  const stillState: FrameState = { t: stillTime, dt: STILL_DT, mx: 0, my: 0, hov: 0 };
  let mx = 0;
  let my = 0;
  let tmx = 0;
  let tmy = 0;
  let hov = 0;
  let thov = 0;
  let dark = 0;
  const readDark = () => (document.documentElement.dataset.theme === 'dark' ? 1 : 0);
  dark = readDark();

  const resize = () => {
    const scale = Math.min(devicePixelRatio || 1, DPR_CAP) * resScale;
    cv.width = Math.max(1, Math.round(cv.clientWidth * scale));
    cv.height = Math.max(1, Math.round(cv.clientHeight * scale));
    gl.viewport(0, 0, cv.width, cv.height);
  };

  // uniform* calls with a null location are spec no-ops, so absent uniforms need no guard
  const draw = (s: FrameState) => {
    gl.uniform2f(uRes, cv.width, cv.height);
    gl.uniform1f(uTime, s.t);
    gl.uniform2f(uMouse, s.mx, -s.my);
    gl.uniform1f(uHov, s.hov);
    gl.uniform1f(uDark, dark);
    bindUniforms?.(gl, u, s);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const renderStill = () => {
    resize();
    draw(stillState);
  };

  let raf = 0;
  let inView = true;
  let lost = false;
  const mql = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = mql.matches;
  const desired = () => !reduce && !lost && inView && !document.hidden;
  const sync = () => {
    if (desired()) {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const t0 = performance.now();
  let last = t0;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, MAX_DT);
    last = now;
    mx = damp(mx, tmx, MOUSE_LAMBDA, dt);
    my = damp(my, tmy, MOUSE_LAMBDA, dt);
    hov = damp(hov, thov, HOVER_LAMBDA, dt);
    state.t = (now - t0) / 1000;
    state.dt = dt;
    state.mx = mx;
    state.my = my;
    state.hov = hov;
    draw(state);
    raf = desired() ? requestAnimationFrame(frame) : 0;
  };

  const io = new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].isIntersecting;
    sync();
  });
  io.observe(cv);
  const ro = new ResizeObserver(() => {
    resize();
    if (reduce) renderStill();
  });
  ro.observe(cv);
  const onVis = () => sync();
  document.addEventListener('visibilitychange', onVis);
  const onMq = (e: MediaQueryListEvent) => {
    reduce = e.matches;
    if (reduce) renderStill();
    sync();
  };
  mql.addEventListener('change', onMq);
  const onTheme = () => {
    dark = readDark();
    if (reduce) renderStill();
  };
  window.addEventListener('vnd:theme', onTheme);

  const onLost = (e: Event) => {
    e.preventDefault(); // allow the context to be restored
    lost = true;
    sync();
  };
  const onRestored = () => {
    if (!setup()) return;
    lost = false;
    resize();
    if (reduce) renderStill();
    sync();
  };
  cv.addEventListener('webglcontextlost', onLost);
  cv.addEventListener('webglcontextrestored', onRestored);

  const onPointerMove = (e: PointerEvent) => {
    if (pointer === 'window') {
      tmx = (e.clientX / innerWidth) * 2 - 1;
      tmy = (e.clientY / innerHeight) * 2 - 1;
      return;
    }
    const r = cv.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    const inside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
    thov = inside ? 1 : 0;
    tmx = inside ? nx * 2 - 1 : 0;
    tmy = inside ? ny * 2 - 1 : 0;
  };
  const onPointerOut = (e: PointerEvent) => {
    if (e.relatedTarget) return; // left the window, not just an element
    thov = 0;
    tmx = 0;
    tmy = 0;
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerout', onPointerOut, { passive: true });

  resize();
  if (reduce) renderStill();
  sync();

  return () => {
    cancelAnimationFrame(raf);
    raf = 0;
    io.disconnect();
    ro.disconnect();
    mql.removeEventListener('change', onMq);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('vnd:theme', onTheme);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerout', onPointerOut);
    cv.removeEventListener('webglcontextlost', onLost);
    cv.removeEventListener('webglcontextrestored', onRestored);
    if (prog) {
      gl.deleteProgram(prog);
      prog = null;
    }
    loseContext();
  };
}
