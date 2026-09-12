<script lang="ts">
  import { onMount } from 'svelte';
  import { mountShaderCanvas } from '$lib/gl';

  let canvas = $state<HTMLCanvasElement>();
  let failed = $state(false);

  const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
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
  vec2 p=uv*1.3+u_mouse*.14;
  float t=u_time*.05;
  vec2 q=vec2(fbm(p+t),fbm(p+vec2(4.7,1.3)-t*.8));
  vec2 r=vec2(fbm(p+2.6*q+vec2(1.7,9.2)+t*.5),fbm(p+2.6*q+vec2(8.3,2.8)-t*.4));
  float f=fbm(p+2.4*r);

  vec3 base=vec3(.039,.063,.051);
  vec3 mid =vec3(.055,.235,.19);
  vec3 lime=vec3(.851,.973,.459);

  float body=smoothstep(.12,.72,f+.22*length(r));
  vec3 col=mix(base,mid,body*.72);

  float w=fbm(p*1.15+1.8*q+t*.7);
  float band=sin((uv.x*.65-uv.y*1.85)*4.4+w*7.5+t*2.6);
  col+=lime*(smoothstep(.92,.995,band)*.55+smoothstep(.7,.99,band)*.13);
  col+=lime*smoothstep(.6,.95,f)*.08;

  col*=1.-.55*dot(uv*vec2(.75,1.05),uv*vec2(.75,1.05));
  col+=h2(gl_FragCoord.xy+fract(u_time)*13.).x*.033;
  O=vec4(col,1.);
}`;

  onMount(() => {
    const cleanup = mountShaderCanvas({
      canvas: canvas!,
      frag: FRAG,
      resScale: 0.6,
      pointer: 'window',
    });
    if (!cleanup) {
      failed = true;
      return;
    }
    return cleanup;
  });
</script>

<canvas bind:this={canvas} class="hero-gl" class:failed aria-hidden="true"></canvas>
