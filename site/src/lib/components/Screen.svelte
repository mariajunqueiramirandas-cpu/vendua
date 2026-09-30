<script lang="ts">
  import { KINDS, SCREENS, screenSrc, type ScreenKey } from '$lib/screens';
  import { theme } from '$lib/theme.svelte';

  // A real admin screenshot: Creme by default, Noite when the visitor's system is dark or they picked
  // the dark theme in the header.
  let {
    key,
    alt = SCREENS[key].what,
    sizes,
    eager = false,
  }: { key: ScreenKey; alt?: string; sizes?: string; eager?: boolean } = $props();

  const kind = $derived(KINDS[SCREENS[key].kind]);
  const set = (theme: 'creme' | 'noite') =>
    kind.widths.map((w) => `${screenSrc(key, theme, w)} ${w}w`).join(', ');
  const fallbackSizes = $derived(
    SCREENS[key].kind === 'phone'
      ? '(max-width: 560px) 70vw, 280px'
      : '(max-width: 900px) 92vw, 1100px',
  );
  const dark = $derived(
    theme.chosen === 'dark'
      ? 'all'
      : theme.chosen === 'light'
        ? 'not all'
        : '(prefers-color-scheme: dark)',
  );
</script>

<picture>
  <source media={dark} srcset={set('noite')} sizes={sizes ?? fallbackSizes} />
  <img
    src={screenSrc(key, 'creme', kind.widths[kind.widths.length - 1])}
    srcset={set('creme')}
    sizes={sizes ?? fallbackSizes}
    width={kind.width}
    height={kind.height}
    {alt}
    loading={eager ? 'eager' : 'lazy'}
    decoding={eager ? 'sync' : 'async'}
    fetchpriority={eager ? 'high' : 'auto'}
  />
</picture>

<style>
  picture,
  img {
    display: block;
    width: 100%;
    height: auto;
  }
</style>
