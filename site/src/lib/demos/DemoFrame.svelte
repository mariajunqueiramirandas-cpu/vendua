<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  // The frame every demo plays in. Before hydration (and without JavaScript) `live` is false and the
  // demo shows its finished state, still; once hydrated it starts from the first step. "recomeçar"
  // remounts the demo, so its state and timers start over.
  let {
    label,
    note,
    children,
  }: {
    label: string;
    /** says plainly that this is an example, in the demo's own words */
    note: string;
    children: Snippet<[{ live: boolean; reduced: boolean }]>;
  } = $props();

  let live = $state(false);
  let reduced = $state(false);
  let run = $state(0);

  onMount(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    const on = () => (reduced = mq.matches);
    mq.addEventListener('change', on);
    live = true;
    return () => mq.removeEventListener('change', on);
  });
</script>

<figure class="demo" aria-label={label}>
  {#key run}
    {@render children({ live, reduced })}
  {/key}
  <figcaption class="foot">
    <span class="note">{note}</span>
    {#if live}
      <button type="button" class="restart" onclick={() => run++}>recomeçar</button>
    {/if}
  </figcaption>
</figure>

<style>
  .demo {
    margin: 0;
    display: grid;
    gap: 14px;
    justify-items: center;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 6px 14px;
    font-size: 0.875rem;
    color: var(--ink-muted);
    text-align: center;
  }
  .restart {
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .restart:hover {
    background: var(--hover);
  }
  .restart:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
</style>
