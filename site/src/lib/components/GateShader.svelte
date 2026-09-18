<script lang="ts">
  import { onMount } from 'svelte';
  import { FRAG_HEAD, NOISE_GLSL, damp, mountShaderCanvas } from '$lib/gl';

  let { open = false } = $props<{ open?: boolean }>();
  let canvas = $state<HTMLCanvasElement>();
  let failed = $state(false);
  let openVal = 0;
  const OPEN_LAMBDA = 4.35; // ≈0.07/frame at 60fps

  const FRAG =
    FRAG_HEAD +
    `uniform float u_open;
` +
    NOISE_GLSL +
    `void main(){
  vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y;
  float t=u_time;

  vec3 deep=mix(vec3(.937,.922,.867),vec3(.024,.038,.031),u_dark);
  vec3 base=mix(vec3(.969,.957,.918),vec3(.039,.063,.051),u_dark);
  vec3 mid =mix(-vec3(.3,.2,.26),vec3(.055,.235,.19),u_dark);
  vec3 lime=vec3(.851,.973,.459);
  vec3 door=mix(vec3(-.85,-.5,-.66),lime,u_dark);

  float fog=fbm(uv*2.4+vec2(t*.05,-t*.035),5);
  vec3 col=mix(deep,base,.55+.45*fog);

  float cx=u_mouse.x*.05;
  float halfw=.009+u_open*.08+.003*sin(t*.65);
  float dx=abs(uv.x-cx);
  float span=smoothstep(.78,.30,abs(uv.y*.7-.03));
  float slit=smoothstep(halfw,halfw*.1,dx);

  float streak=fbm(vec2(uv.x*55.,uv.y*2.4-t*.3),5);
  col+=door*slit*span*(.42+.62*streak+.12*sin(t*1.4));
  col+=lime*slit*span*streak*.3*(1.-u_dark);

  float edge=smoothstep(halfw*2.6,halfw*1.05,dx)-slit;
  col+=door*edge*span*.16;

  col+=door*exp(-dx*6.5)*span*(.09+.30*u_open);
  col+=mid*exp(-dx*3.5)*span*.10;
  col+=door*exp(-abs(uv.y+.42)*6.)*exp(-dx*3.5)*(.04+.10*u_open);

  float dust=smoothstep(.94,1.,n2(vec2(uv.x*110.,uv.y*36.-t*.5)));
  col+=door*dust*slit*span*.4;

  col*=1.-mix(.38,.62,u_dark)*dot(uv*vec2(.72,1.),uv*vec2(.72,1.));
  col+=(h22(gl_FragCoord.xy+fract(t)*13.).x-.5)*mix(.05,.064,u_dark);
  O=vec4(col,1.);
}`;

  onMount(() => {
    const cleanup = mountShaderCanvas({
      canvas: canvas!,
      frag: FRAG,
      stillTime: 8,
      pointer: 'window',
      bindUniforms: (gl, u, s) => {
        openVal = damp(openVal, open ? 1 : 0, OPEN_LAMBDA, s.dt);
        gl.uniform1f(u('u_open'), openVal);
      },
    });
    if (!cleanup) {
      failed = true;
      return;
    }
    return cleanup;
  });
</script>

<canvas bind:this={canvas} class="gate-gl" class:failed aria-hidden="true"></canvas>
