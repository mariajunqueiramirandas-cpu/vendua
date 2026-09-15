<script lang="ts">
  import { onMount } from 'svelte';
  import gsap from 'gsap';

  let veil = $state<HTMLElement>();

  onMount(() => {
    if (!veil) return;
    if (
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      getComputedStyle(veil).display === 'none'
    )
      return;
    const el = veil;
    document.body.style.overflow = 'hidden';
    const slit = el.querySelector('.veil-slit') as HTMLElement;
    const word = el.querySelector('.veil-word') as HTMLElement;
    const countEl = el.querySelector('.veil-count') as HTMLElement;
    const left = el.querySelector('.veil-left') as HTMLElement;
    const right = el.querySelector('.veil-right') as HTMLElement;
    const n = { v: 0 };
    const tl = gsap.timeline({
      onComplete: () => {
        try {
          sessionStorage.setItem('vnd-intro', '1');
        } catch {}
        document.documentElement.classList.add('seen');
        el.remove();
        document.body.style.overflow = '';
      },
    });
    tl.fromTo(slit, { scaleY: 0 }, { scaleY: 1, duration: 0.6, ease: 'power3.out' }, 0.05)
      .from(word, { opacity: 0, y: 10, duration: 0.55, ease: 'power2.out' }, 0.2)
      .from(countEl, { opacity: 0, duration: 0.4, ease: 'none' }, 0.3)
      .to(
        n,
        {
          v: 100,
          duration: 1.0,
          ease: 'power2.inOut',
          onUpdate: () => {
            countEl.textContent = 'SINAL · ' + String(Math.round(n.v)).padStart(3, '0');
          },
        },
        0.3,
      )
      .to(slit, { scaleX: 6, duration: 0.3, ease: 'power2.in' }, 1.42)
      .to([slit, word, countEl], { opacity: 0, duration: 0.28, ease: 'power1.in' }, 1.6)
      .to(left, { xPercent: -101, duration: 0.95, ease: 'power4.inOut' }, 1.62)
      .to(right, { xPercent: 101, duration: 0.95, ease: 'power4.inOut' }, 1.62);
    return () => {
      tl.kill();
      document.body.style.overflow = '';
    };
  });
</script>

<div class="intro-veil" bind:this={veil} aria-hidden="true">
  <div class="veil-half veil-left"></div>
  <div class="veil-half veil-right"></div>
  <div class="veil-slit"></div>
  <p class="veil-word">venduá<span aria-hidden="true">.</span></p>
  <p class="veil-count">SINAL · 000</p>
</div>
