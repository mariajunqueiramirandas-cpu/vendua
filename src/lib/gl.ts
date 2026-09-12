const VERT = `#version 300 es
void main(){vec2 v=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(v*2.-1.,0.,1.);}`;

export type FrameState = { t: number; mx: number; my: number; hov: number };

export function mountShaderCanvas(options: {
  canvas: HTMLCanvasElement;
  frag: string;
  resScale?: number;
  stillTime?: number;
  pointer?: 'window' | 'local';
  bindUniforms?: (
    gl: WebGL2RenderingContext,
    u: (name: string) => WebGLUniformLocation | null,
    s: FrameState,
  ) => void;
}): (() => void) | null {
  const {
    canvas: cv,
    frag,
    resScale = 0.6,
    stillTime = 14,
    pointer = 'window',
    bindUniforms,
  } = options;
  const gl = cv.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    alpha: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;

  let prog: WebGLProgram | null = null;
  let uRes: WebGLUniformLocation | null = null;
  let uTime: WebGLUniformLocation | null = null;
  let uMouse: WebGLUniformLocation | null = null;
  let uHov: WebGLUniformLocation | null = null;
  const extra = new Map<string, WebGLUniformLocation | null>();
  const u = (n: string) => {
    if (!extra.has(n)) extra.set(n, prog ? gl.getUniformLocation(prog, n) : null);
    return extra.get(n) ?? null;
  };

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const setup = () => {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return false;
    prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    extra.clear();
    uRes = gl.getUniformLocation(prog, 'u_res');
    uTime = gl.getUniformLocation(prog, 'u_time');
    uMouse = gl.getUniformLocation(prog, 'u_mouse');
    uHov = gl.getUniformLocation(prog, 'u_hover');
    return true;
  };
  if (!setup()) return null;

  let mx = 0;
  let my = 0;
  let tmx = 0;
  let tmy = 0;
  let hov = 0;
  let thov = 0;
  const onMoveWin = (e: PointerEvent) => {
    tmx = (e.clientX / innerWidth) * 2 - 1;
    tmy = (e.clientY / innerHeight) * 2 - 1;
  };
  const onMoveLocal = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    tmx = ((e.clientX - r.left) / r.width) * 2 - 1;
    tmy = ((e.clientY - r.top) / r.height) * 2 - 1;
  };
  const onEnter = () => (thov = 1);
  const onLeave = () => {
    thov = 0;
    tmx = 0;
    tmy = 0;
  };

  const resize = () => {
    const scale = Math.min(devicePixelRatio || 1, 1.5) * resScale;
    cv.width = Math.max(1, Math.round(cv.clientWidth * scale));
    cv.height = Math.max(1, Math.round(cv.clientHeight * scale));
    gl.viewport(0, 0, cv.width, cv.height);
  };
  resize();

  let raf = 0;
  let inView = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  const frame = () => {
    mx += (tmx - mx) * 0.05;
    my += (tmy - my) * 0.05;
    hov += (thov - hov) * 0.08;
    const t = (performance.now() - t0) / 1000;
    gl.uniform2f(uRes, cv.width, cv.height);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uMouse, mx, -my);
    if (uHov) gl.uniform1f(uHov, hov);
    bindUniforms?.(gl, u, { t, mx, my, hov });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = inView ? requestAnimationFrame(frame) : 0;
  };

  if (reduce) {
    const still = () => {
      resize();
      gl.uniform2f(uRes, cv.width, cv.height);
      gl.uniform1f(uTime, stillTime);
      gl.uniform2f(uMouse, 0, 0);
      if (uHov) gl.uniform1f(uHov, 0);
      bindUniforms?.(gl, u, { t: stillTime, mx: 0, my: 0, hov: 0 });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    still();
    const ro = new ResizeObserver(still);
    ro.observe(cv);
    return () => ro.disconnect();
  }

  const io = new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].isIntersecting;
    if (!inView) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      raf = requestAnimationFrame(frame);
    }
  });
  io.observe(cv);
  const ro = new ResizeObserver(resize);
  ro.observe(cv);
  const onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const onRestored = () => {
    if (!setup()) return;
    resize();
    if (inView && !raf) raf = requestAnimationFrame(frame);
  };
  cv.addEventListener('webglcontextlost', onLost);
  cv.addEventListener('webglcontextrestored', onRestored);
  if (pointer === 'window') {
    window.addEventListener('pointermove', onMoveWin, { passive: true });
  } else {
    cv.addEventListener('pointermove', onMoveLocal, { passive: true });
    cv.addEventListener('pointerenter', onEnter);
    cv.addEventListener('pointerleave', onLeave);
  }
  raf = requestAnimationFrame(frame);

  return () => {
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('pointermove', onMoveWin);
    cv.removeEventListener('pointermove', onMoveLocal);
    cv.removeEventListener('pointerenter', onEnter);
    cv.removeEventListener('pointerleave', onLeave);
    cv.removeEventListener('webglcontextlost', onLost);
    cv.removeEventListener('webglcontextrestored', onRestored);
    cancelAnimationFrame(raf);
  };
}
