<script lang="ts">
  import type { Snippet } from 'svelte';

  // One stop of the store's day. `sky` is the section's background (run it from one --sky-N stop to the
  // next so sections join without a seam); `tone="after"` is for dusk and night, where text stays light
  // in both themes. `hour` prints the small clock chip ("6h") that names the moment. `overlay` is for
  // the first section, which runs up under the sticky header: its content and chip start below it.
  let {
    id,
    sky,
    tone = 'day',
    hour,
    label,
    labelledby,
    overlay = false,
    class: cls = '',
    children,
  }: {
    id?: string;
    sky: string;
    tone?: 'day' | 'after';
    hour?: string;
    label?: string;
    labelledby?: string;
    overlay?: boolean;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<section
  {id}
  class="section {tone} {cls}"
  class:overlay
  style="background: {sky}"
  aria-label={label}
  aria-labelledby={labelledby}
>
  <div class="wrap inner">
    {#if hour}<span class="hour" aria-hidden="true">{hour}</span>{/if}
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
  .overlay {
    --under-header: calc(var(--header-h) + env(safe-area-inset-top, 0px));
  }
  .overlay > .inner {
    padding-top: calc(clamp(56px, 7vw, 96px) + var(--under-header));
  }
  .after {
    --ink: var(--after-ink);
    --ink-muted: var(--after-muted);
    --line: var(--after-line);
    --surface: var(--after-card);
    color: var(--after-ink);
  }
  .hour {
    position: absolute;
    top: clamp(20px, 3vw, 32px);
    left: var(--gutter);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 6px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 70%, transparent);
    box-shadow: 0 0 0 1px var(--line);
    font: 600 13px/1 var(--font-display);
    color: var(--ink-muted);
  }
  .overlay .hour {
    top: calc(var(--under-header) + 4px);
  }
  /* a dusk pill, so the chip reads where an after section still starts on a light sky (the sunset's gold) */
  .after .hour {
    background: color-mix(in srgb, var(--sky-5) 85%, transparent);
    color: var(--after-ink);
  }
  .hour::before {
    content: '';
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid currentColor;
    background: conic-gradient(currentColor 0 25%, transparent 0);
  }
</style>
