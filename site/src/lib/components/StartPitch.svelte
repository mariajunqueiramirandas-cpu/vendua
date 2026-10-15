<script lang="ts">
  import { onMount } from 'svelte';
  import { loadLivePlans } from '$lib/plans/live.svelte';
  import { afterLine, trialLine } from '$lib/plans/pitch';
  import Start from './Start.svelte';

  // The call to action with its promise beside it: the trial on the button's line, and under it what
  // it costs after and that no order pays a fee. Where a visitor decides (the hero, the dawn band of
  // a page per kind of shop), so they don't have to scroll to the plans to learn there's no catch.
  let { tone = 'day', class: cls = '' }: { tone?: 'day' | 'after'; class?: string } = $props();

  const trial = $derived(trialLine());
  const after = $derived(afterLine());
  onMount(() => void loadLivePlans());
</script>

<div class="pitch {tone} {cls}">
  <Start {tone}>
    {#if trial}<span class="trial">{trial}.</span>{/if}
  </Start>
  <p class="after">{after}</p>
</div>

<style>
  .pitch {
    display: grid;
    justify-items: start;
    gap: 10px;
  }
  .pitch :global(.start) {
    gap: 10px 16px;
  }
  /* the trial is the reason to press: ink, not a footnote */
  .pitch :global(.note) {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
  }
  .after {
    max-width: 40ch;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: color-mix(in srgb, var(--ink) 50%, var(--ink-muted));
  }
  .pitch.after :global(.note) {
    color: var(--after-ink);
  }
  .pitch.after .after {
    color: var(--after-muted);
  }
  /* one thumb wide on a phone: the button takes the column, the trial reads under it */
  @media (max-width: 479px) {
    .pitch :global(.start) {
      width: 100%;
    }
    .pitch :global(.pill) {
      width: 100%;
      justify-content: center;
    }
  }
</style>
