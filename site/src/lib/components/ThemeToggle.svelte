<script lang="ts">
  import { choose, current, theme, type Theme } from '$lib/theme.svelte';

  // Light/dark switch in the header. It needs JS, so the header hides it in <noscript>.
  let shown = $state<Theme>('light');

  $effect(() => {
    const set = document.documentElement.dataset.theme;
    theme.chosen = set === 'light' || set === 'dark' ? set : null;
    shown = current();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => (shown = current());
    mq.addEventListener('change', follow);
    return () => mq.removeEventListener('change', follow);
  });

  function flip() {
    choose(shown === 'dark' ? 'light' : 'dark');
    shown = current();
  }
</script>

<button
  class="toggle"
  type="button"
  data-theme-toggle
  aria-label={shown === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
  onclick={flip}
>
  <svg viewBox="0 0 24 24" aria-hidden="true" class:dark={shown === 'dark'}>
    <!-- one drawing: the sun's disc, and a second disc that slides over it to leave a crescent -->
    <mask id="theme-cut">
      <rect width="24" height="24" fill="#fff" />
      <circle class="bite" cx="24" cy="4" r="8" fill="#000" />
    </mask>
    <circle class="disc" cx="12" cy="12" r="5" mask="url(#theme-cut)" />
    <g class="rays">
      <path
        d="M12 1.5v2.2M12 20.3v2.2M1.5 12h2.2M20.3 12h2.2M4.6 4.6l1.5 1.5M17.9 17.9l1.5 1.5M4.6 19.4l1.5-1.5M17.9 6.1l1.5-1.5"
      />
    </g>
  </svg>
</button>

<style>
  .toggle {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .toggle:hover {
    background: var(--hover);
  }
  svg {
    width: 22px;
    height: 22px;
    overflow: visible;
  }
  .disc {
    fill: currentColor;
    transform-origin: 12px 12px;
    transition: transform 0.45s var(--ease-soft);
  }
  .rays {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    transform-origin: 12px 12px;
    transition:
      opacity 0.3s var(--ease-soft),
      rotate 0.45s var(--ease-soft),
      scale 0.45s var(--ease-soft);
  }
  .bite {
    transition: transform 0.45s var(--ease-soft);
  }
  /* dark: the moon (the sun grows, loses its rays and a bite slides across it) */
  .dark .disc {
    transform: scale(1.7);
  }
  .dark .rays {
    opacity: 0;
    rotate: 45deg;
    scale: 0.6;
  }
  .dark .bite {
    transform: translate(-7px, 3px);
  }
</style>
