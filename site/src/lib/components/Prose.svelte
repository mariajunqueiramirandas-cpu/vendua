<script lang="ts">
  import type { Snippet } from 'svelte';

  // Long reading text (guides, about): plain h2/h3/p/ul/ol/a are styled here. <aside class="tip"> is
  // the "na Venduá" note, where the advice meets the product; <figure class="shot"> holds a phone
  // with a real screen and its caption.
  let { children }: { children: Snippet } = $props();
</script>

<div class="prose">{@render children()}</div>

<style>
  .prose {
    display: grid;
    gap: 18px;
    max-width: 40rem;
    --body: color-mix(in srgb, var(--ink) 70%, var(--ink-muted));
  }
  .prose :global(h2) {
    margin-top: 28px;
    font-family: var(--font-display);
    font-size: 1.75rem;
    line-height: 1.2;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .prose :global(h3) {
    margin-top: 8px;
    font: 600 1.25rem/1.35 var(--font-display);
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .prose > :global(:first-child) {
    margin-top: 0;
  }
  .prose :global(p),
  .prose :global(li) {
    font-size: 1.0625rem;
    line-height: 1.75;
    color: var(--body);
  }
  .prose :global(strong) {
    color: var(--ink);
    font-weight: 650;
  }
  .prose :global(ul),
  .prose :global(ol) {
    display: grid;
    gap: 8px;
    padding-left: 1.4em;
  }
  .prose :global(a) {
    color: var(--ink);
    font-weight: 600;
    text-decoration-color: color-mix(in srgb, var(--ink) 40%, transparent);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 4px;
  }
  .prose :global(a:hover) {
    text-decoration-color: currentColor;
  }

  /* the "na Venduá" note: where the guide meets the product, set apart from the advice */
  .prose :global(.tip) {
    display: grid;
    gap: 8px;
    margin-block: 8px;
    padding: 20px 22px;
    border-radius: var(--radius-lg);
    background: var(--spark-soft);
  }
  .prose :global(.tip p) {
    color: var(--ink);
  }
  .prose :global(.tip h3) {
    margin: 0;
    font-size: 1.0625rem;
  }

  .prose :global(.shot) {
    display: grid;
    justify-items: center;
    gap: 14px;
    margin-block: 16px;
  }
  .prose :global(.shot > :first-child) {
    width: min(250px, 62vw);
  }
  .prose :global(figcaption) {
    max-width: 34ch;
    text-align: center;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
</style>
