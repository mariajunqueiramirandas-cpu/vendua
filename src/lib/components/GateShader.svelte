<script lang="ts">
  import { onMount } from 'svelte';
  import { mountShaderCanvas } from '$lib/gl';

  let { open = false } = $props<{ open?: boolean }>();
  let canvas = $state<HTMLCanvasElement>();
  let failed = $state(false);
  let openVal = 0;

  const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_open;
out vec4 O;

vec2 h2(vec2 p){
  p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));
  return -1.+2.*fract(sin(p)*43758.5453123);
}
float n2(vec2 p){
  vec2 i=floor(p),f=fract(p);
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(dot(h2(i),f),dot(h2(i+vec2(1,0)),f-vec2(1,0)),u.x),
             mix(dot(h2(i+vec2(0,1)),f-vec2(0,1)),dot(h2(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y);
}
float fbm(vec2 p){
  float v=0.,a=.55;
  for(int i=0;i<5;i++){v+=a*n2(p);p=p*2.03+vec2(1.7,-1.2);a*=.5;}
  return v;
}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y;
  float t=u_time;

  vec3 deep=vec3(.024,.038,.031);
  vec3 base=vec3(.039,.063,.051);
  vec3 mid =vec3(.055,.235,.19);
  vec3 lime=vec3(.851,.973,.459);

  float fog=fbm(uv*2.4+vec2(t*.05,-t*.035));
  vec3 col=mix(deep,base,.55+.45*fog);

  float cx=u_mouse.x*.05;
  float halfw=.009+u_open*.08+.003*sin(t*.65);
  float dx=abs(uv.x-cx);
  float span=smoothstep(.78,.30,abs(uv.y*.7-.03));
  float slit=smoothstep(halfw,halfw*.1,dx);

  float streak=fbm(vec2(uv.x*55.,uv.y*2.4-t*.3));
  col+=lime*slit*span*(.42+.62*streak+.12*sin(t*1.4));

  float edge=smoothstep(halfw*2.6,halfw*1.05,dx)-slit;
  col+=lime*edge*span*.16;

  col+=lime*exp(-dx*6.5)*span*(.09+.30*u_open);
  col+=mid*exp(-dx*3.5)*span*.10;
  col+=lime*exp(-abs(uv.y+.42)*6.)*exp(-dx*3.5)*(.04+.10*u_open);

  float dust=smoothstep(.94,1.,n2(vec2(uv.x*110.,uv.y*36.-t*.5)));
  col+=lime*dust*slit*span*.4;

  col*=1.-.62*dot(uv*vec2(.72,1.),uv*vec2(.72,1.));
  col+=h2(gl_FragCoord.xy+fract(t)*13.).x*.032;
  O=vec4(col,1.);
}`;

  onMount(() => {
    const cleanup = mountShaderCanvas({
      canvas: canvas!,
      frag: FRAG,
      resScale: 0.6,
      stillTime: 8,
      pointer: 'window',
      bindUniforms: (gl, u) => {
        openVal += ((open ? 1 : 0) - openVal) * 0.07;
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
