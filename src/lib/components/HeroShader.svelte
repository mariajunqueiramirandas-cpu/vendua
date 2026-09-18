<script lang="ts">
  import { onMount } from 'svelte';
  import { FRAG_HEAD, NOISE_GLSL, mountShaderCanvas } from '$lib/gl';

  let canvas = $state<HTMLCanvasElement>();
  let failed = $state(false);

  const FRAG =
    FRAG_HEAD +
    NOISE_GLSL +
    `void main(){
  vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y;
  vec2 p=uv*1.3+u_mouse*.14;
  float t=u_time*.05;
  vec2 q=vec2(fbm(p+t,5),fbm(p+vec2(4.7,1.3)-t*.8,5));
  vec2 r=vec2(fbm(p+2.6*q+vec2(1.7,9.2)+t*.5,5),fbm(p+2.6*q+vec2(8.3,2.8)-t*.4,5));
  float f=fbm(p+2.4*r,5);

  vec3 base=mix(vec3(.969,.957,.918),vec3(.039,.063,.051),u_dark);
  vec3 mid =mix(vec3(.14,.32,.26),vec3(.055,.235,.19),u_dark);
  vec3 lime=vec3(.851,.973,.459);
  vec3 core=mix(vec3(-.85,-.5,-.66),lime,u_dark);

  float body=smoothstep(.12,.72,f+.22*length(r));
  vec3 col=mix(base,mid,body*.72);

  float w=fbm(p*1.15+1.8*q+t*.7,5);
  float band=sin((uv.x*.65-uv.y*1.85)*4.4+w*7.5+t*2.6);
  col+=core*(smoothstep(.92,.995,band)*.55+smoothstep(.7,.99,band)*.13);
  col+=lime*smoothstep(.6,.95,f)*.08;

  col*=1.-mix(.32,.55,u_dark)*dot(uv*vec2(.75,1.05),uv*vec2(.75,1.05));
  col+=(h22(gl_FragCoord.xy+fract(u_time)*13.).x-.5)*mix(.05,.066,u_dark);
  O=vec4(col,1.);
}`;

  onMount(() => {
    const cleanup = mountShaderCanvas({
      canvas: canvas!,
      frag: FRAG,
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
