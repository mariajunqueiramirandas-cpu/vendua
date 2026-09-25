<script lang="ts">
  import { onMount } from 'svelte';
  import { VEIL_SKIP_EVENT } from '$lib/intro';

  const SKIP_RATE = 4;

  let veil = $state<HTMLElement>();
  let done = $state(false);

  onMount(() => {
    const el = veil;
    if (!el || getComputedStyle(el).display === 'none') {
      done = true;
      return;
    }

    document.body.style.overflow = 'hidden';

    // keep the covered page inert — otherwise Tab lands on controls hidden behind the veil
    const covered = [...(el.parentElement?.children ?? [])].filter(
      (child): child is HTMLElement => child !== el && child instanceof HTMLElement,
    );
    const previouslyInert = covered.map((child) => child.inert);
    covered.forEach((child) => (child.inert = true));

    const animations = el.getAnimations({ subtree: true });
    const skip = () => {
      animations.forEach((a) => (a.playbackRate = SKIP_RATE));
      dispatchEvent(new Event(VEIL_SKIP_EVENT));
    };
    const skipEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    skipEvents.forEach((type) => addEventListener(type, skip, { once: true, passive: true }));

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      skipEvents.forEach((type) => removeEventListener(type, skip));
      covered.forEach((child, i) => (child.inert = previouslyInert[i] ?? false));
      document.body.style.overflow = '';
    };

    // Cancelled animations (e.g. reduced motion switched on mid-intro) reject; unlock either way.
    const finish = () => {
      if (released) return;
      try {
        sessionStorage.setItem('vnd-intro', '1');
      } catch {}
      document.documentElement.classList.add('seen');
      release();
      done = true;
    };
    Promise.all(animations.map((a) => a.finished)).then(finish, finish);

    return release;
  });
</script>

{#if !done}
  <div class="intro-veil" bind:this={veil} aria-hidden="true">
    <div class="veil-half veil-left"></div>
    <div class="veil-half veil-right"></div>
    <div class="veil-slit"></div>
    <p class="veil-word">
      <span class="veil-word-inner">venduá<span class="veil-dot">.</span></span>
    </p>
    <p class="veil-count">SINAL · <span class="veil-count-n"></span></p>
  </div>
{/if}
