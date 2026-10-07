<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  // This post's figure: like demos/DemoFrame, the server (and a reader without JavaScript) gets the
  // finished state, still; once hydrated `live` turns on, and "recomeçar" remounts the widget.
  // Its caption carries the honesty note in the widget's own words.
  let {
    label,
    note,
    restart = true,
    children,
  }: {
    label: string;
    note: string;
    restart?: boolean;
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

<figure class="pf" aria-label={label}>
  {#key `${run}-${live}`}
    {@render children({ live, reduced })}
  {/key}
  <figcaption class="pf-foot">
    <span>{note}</span>
    {#if live && restart}
      <button type="button" class="pf-restart" onclick={() => run++}>recomeçar</button>
    {/if}
  </figcaption>
</figure>

<style>
  figure.pf {
    margin: 12px 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    min-width: 0;
  }
  figure.pf figcaption.pf-foot {
    max-width: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 6px 14px;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
    text-align: center;
  }
  .pf-restart {
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
  .pf-restart:hover {
    background: var(--hover);
  }
  .pf-restart:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
</style>
