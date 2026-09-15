<script lang="ts">
  import { onMount } from 'svelte';
  import gsap from 'gsap';
  import Seo from '$lib/components/Seo.svelte';
  import GateShader from '$lib/components/GateShader.svelte';
  import { site } from '$lib/content/site';

  let gateOpen = $state(false);

  onMount(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const veil = document.querySelector<HTMLElement>('.intro-veil');
    const introDelay = veil && getComputedStyle(veil).display !== 'none' ? 1.5 : 0;
    gsap
      .timeline({ defaults: { ease: 'power3.out' }, delay: introDelay })
      .from('.gate-gl', { opacity: 0, scale: 1.07, duration: 1.8, ease: 'power2.out' }, 0)
      .from('.gate-eyebrow', { opacity: 0, y: -12, duration: 0.6 }, 0.25)
      .from('.gate-title .line-mask > span', { yPercent: 115, duration: 1.1, stagger: 0.12 }, 0.35)
      .from(
        '.gate-intro, .gate-actions, .gate-fine',
        { opacity: 0, y: 18, duration: 0.7, stagger: 0.1 },
        0.95,
      )
      .from('.gate-meta', { opacity: 0, duration: 0.9 }, 1.25);
  });
</script>

<Seo
  title="Acesso antecipado | Venduá"
  description="A Venduá está em desenvolvimento. O acesso antecipado é por convite — o único canal é o direct."
  path="/contato/"
/>
<section class="gate-stage" aria-labelledby="gate-title">
  <GateShader open={gateOpen} />
  <div class="gate-inner container">
    <p class="eyebrow gate-eyebrow">
      <span class="signal-dot"></span>Em desenvolvimento · acesso antecipado por convite
    </p>
    <h1 class="gate-title" id="gate-title">
      <span class="line-mask"><span>Não há formulário.</span></span>
      <span class="line-mask"><span>Só uma <em class="serif">porta.</em></span></span>
    </h1>
    <p class="intro gate-intro">
      Quem entra agora garante lugar na lista do lançamento. Peça acesso pelo direct e diga o que
      vende já na primeira mensagem — cada pedido é lido por uma pessoa.
    </p>
    <div class="actions gate-actions">
      <a
        class="button"
        href={site.instagramDmUrl}
        target="_blank"
        rel="noreferrer"
        onpointerenter={() => (gateOpen = true)}
        onpointerleave={() => (gateOpen = false)}
        onfocus={() => (gateOpen = true)}
        onblur={() => (gateOpen = false)}
        >Abrir @vendua.digital <span class="sr-only">(nova aba)</span><span aria-hidden="true"
          >↗</span
        ></a
      >
    </div>
    <p class="fine gate-fine">O Instagram pode solicitar login.</p>
  </div>
  <div class="gate-meta container" aria-hidden="true">
    <span>VND//WORK — Portal</span>
    <span>Status: em desenvolvimento · Canal: direct · Leitura: humana</span>
  </div>
</section>
