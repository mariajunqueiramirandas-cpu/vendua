<script lang="ts">
  import { onMount } from 'svelte';

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

    // Keep the page under the veil out of the tab order and pointer reach while
    // the intro plays — otherwise Tab lands on controls hidden behind it.
    const covered = [...(el.parentElement?.children ?? [])].filter(
      (child): child is HTMLElement => child !== el && child instanceof HTMLElement,
    );
    const previouslyInert = covered.map((child) => child.inert);
    covered.forEach((child) => (child.inert = true));

    const animations = el.getAnimations({ subtree: true });
    const skip = () => animations.forEach((a) => (a.playbackRate = SKIP_RATE));
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

    Promise.all(animations.map((a) => a.finished)).then(
      () => {
        try {
          sessionStorage.setItem('vnd-intro', '1');
        } catch {}
        document.documentElement.classList.add('seen');
        release();
        done = true;
      },
      () => {},
    );

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
