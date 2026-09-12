<script lang="ts">
  import { onMount } from 'svelte';
  import { mountShaderCanvas } from '$lib/gl';

  let { mode }: { mode: number } = $props();
  let canvas = $state<HTMLCanvasElement>();
  let failed = $state(false);

  const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_hover;
uniform int u_mode;
uniform float u_dark;
out vec4 O;

float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
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
float fbm(vec2 p){
  float v=0.,a=.55;
  for(int i=0;i<4;i++){v+=a*n2(p);p=p*2.02+vec2(1.7,-1.2);a*=.5;}
  return v;
}
vec3 modeCells(vec2 uv,float t){
  vec3 BASE=mix(vec3(.925,.906,.835),vec3(.039,.063,.051),u_dark);
  vec3 MID =mix(-vec3(.5,.36,.44),vec3(.055,.235,.19),u_dark);
  vec3 LIME=mix(-vec3(.75,.45,.6),vec3(.851,.973,.459),u_dark);
  vec2 g=uv*vec2(8.,4.6);
  vec2 id=floor(g); vec2 f=fract(g);
  float rnd=h21(id);
  float on=step(.62,fract(rnd+t*.09+rnd*5.));
  float blk=step(.10,f.x)*step(f.x,.90)*step(.18,f.y)*step(f.y,.82);
  float scan=smoothstep(.05,.0,abs(uv.y+.85-mod(t*.32,1.9)));
  vec3 col=BASE;
  col+=MID*blk*mix(.34,.22,u_dark)*(.9+.4*rnd);
  col+=LIME*blk*on*(mix(.55,.28,u_dark)+.5*fract(rnd*9.+t*.35));
  col+=LIME*scan*.4;
  return col;
}
vec3 modeFolds(vec2 uv,float t){
  vec3 BASE=mix(vec3(.925,.906,.835),vec3(.039,.063,.051),u_dark);
  vec3 MID =mix(-vec3(.5,.36,.44),vec3(.055,.235,.19),u_dark);
  vec3 LIME=mix(-vec3(.75,.45,.6),vec3(.851,.973,.459),u_dark);
  vec2 p=uv*1.9+u_mouse*.1;
  for(int i=0;i<4;i++){
    p=abs(p)-(.6+.18*sin(t*.3+float(i)*1.7));
    float a=.45+.14*sin(t*.18+float(i)*.8);
    p=mat2(cos(a),-sin(a),sin(a),cos(a))*p;
  }
  float l=min(abs(p.x),abs(p.y));
  float line=smoothstep(mix(.085,.055,u_dark),mix(.012,.006,u_dark),l);
  float r=length(p);
  float node=smoothstep(.14,.0,r);
  vec3 col=BASE+MID*smoothstep(1.3,.2,r)*.28;
  col+=LIME*line*mix(1.,.75,u_dark);
  col+=LIME*node*mix(.7,.45,u_dark);
  return col;
}
vec3 modeFlow(vec2 uv,float t){
  vec3 BASE=mix(vec3(.925,.906,.835),vec3(.039,.063,.051),u_dark);
  vec3 MID =mix(-vec3(.5,.36,.44),vec3(.055,.235,.19),u_dark);
  vec3 LIME=mix(-vec3(.75,.45,.6),vec3(.851,.973,.459),u_dark);
  vec2 p=uv*2.5+u_mouse*.12;
  float w=fbm(vec2(p.x*.55-t*.1, p.y*1.3));
  float ly=(p.y+w*.8)*9.;
  float id=floor(ly); float f=fract(ly);
  float line=smoothstep(.1,.0,f)*smoothstep(.62,.18,f);
  float lane=h21(vec2(id,4.));
  float pos=fract(p.x*.32-t*(.25+.75*lane)+lane*6.);
  float dash=smoothstep(.05,.3,pos)*smoothstep(.95,.55,pos);
  vec3 col=BASE+MID*(.2+.3*w);
  col+=LIME*line*dash*(.3+.7*lane)*mix(1.5,1.15,u_dark);
  return col;
}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y;
  float t=u_time*(1.+u_hover*.5);
  vec3 col= u_mode==0 ? modeCells(uv,t) : u_mode==1 ? modeFolds(uv,t) : modeFlow(uv,t);
  col*=1.-mix(.3,.45,u_dark)*dot(uv*vec2(.85,1.15),uv*vec2(.85,1.15));
  col+=(h21(gl_FragCoord.xy+fract(u_time)*17.)-.5)*mix(.05,.032,u_dark);
  col*=.92+u_hover*.28;
  O=vec4(col,1.);
}`;

  onMount(() => {
    const cleanup = mountShaderCanvas({
      canvas: canvas!,
      frag: FRAG,
      resScale: 0.75,
      stillTime: 7 + mode * 4.7,
      pointer: 'local',
      bindUniforms: (gl, u) => {
        gl.uniform1i(u('u_mode'), mode);
        gl.uniform1f(u('u_dark'), document.documentElement.dataset.theme === 'dark' ? 1 : 0);
      },
    });
    if (!cleanup) {
      failed = true;
      return;
    }
    return cleanup;
  });
</script>

<canvas bind:this={canvas} class="tx-gl" class:failed aria-hidden="true"></canvas>
