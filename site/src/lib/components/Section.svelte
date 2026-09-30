<script lang="ts">
  import type { Snippet } from 'svelte';

  // One stop of the store's day. `sky` is the section's background (run it from one --sky-N stop to the
  // next so sections join without a seam); `tone="after"` is for dusk and night, where text stays light
  // in both themes. `overlay` is for the first section, which runs up under the sticky header: its
  // content starts below it. `bleed` is for a section that ends on a phone: its drop shadow runs past the
  // bottom edge, so the section clips only sideways and paints over the next one, where the shadow fades
  // out instead of stopping in a hard line. Two bleeding sections must not touch.
  // data-tone (+ where the sunset band turns dark) lets the header's glass follow the sky under it.
  let {
    id,
    sky,
    tone = 'day',
    label,
    labelledby,
    overlay = false,
    bleed = false,
    class: cls = '',
    children,
  }: {
    id?: string;
    sky: string;
    tone?: 'day' | 'after';
    label?: string;
    labelledby?: string;
    overlay?: boolean;
    bleed?: boolean;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<section
  {id}
  class="section {tone} {cls}"
  class:overlay
  class:bleed
  style="background: {sky}"
  data-tone={tone}
  data-dark-from={sky.includes('--sunset') ? 240 : undefined}
  aria-label={label}
  aria-labelledby={labelledby}
>
  <div class="wrap inner">
    {@render children()}
  </div>
</section>

<style>
  .section {
    position: relative;
    isolation: isolate;
    overflow: clip;
    color: var(--ink);
  }
  .inner {
    position: relative;
    padding-block: clamp(64px, 9vw, 128px);
  }
  .bleed {
    overflow: clip visible;
    z-index: 1;
  }
  .overlay {
    --under-header: calc(var(--header-h) + env(safe-area-inset-top, 0px));
  }
  .overlay > .inner {
    padding-top: calc(clamp(28px, 5vw, 72px) + var(--under-header));
  }
  .after {
    --ink: var(--after-ink);
    --ink-muted: var(--after-muted);
    --line: var(--after-line);
    --surface: var(--after-card);
    color: var(--after-ink);
  }
</style>
