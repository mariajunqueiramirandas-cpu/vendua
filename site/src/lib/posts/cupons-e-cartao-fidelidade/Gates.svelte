<script lang="ts">
  import type { Gate } from './rules';

  // Core's coupon checks as a column of gates, in evaluateCoupon's order: the one that stops the
  // coupon says so in the shopper's own words, and the ones after it are never asked.
  let { gates }: { gates: Gate[] } = $props();

  const MARK = { pass: '✓', stop: '✕', skip: '', na: '–' } as const;
  const WORD = {
    pass: 'passou',
    stop: 'parou aqui',
    skip: 'nem chegou aqui',
    na: 'não se aplica',
  } as const;
</script>

<ol class="gates">
  {#each gates as g (g.id)}
    <li class="gate" data-state={g.state}>
      <span class="mark" aria-hidden="true">{MARK[g.state]}</span>
      <div class="text">
        <p class="q">
          {g.question} <span class="word">{WORD[g.state]}</span>
        </p>
        {#if g.state !== 'skip'}
          <p class="note">{g.note}</p>
        {/if}
        {#if g.state === 'stop' && g.says}
          <p class="says">O cliente lê: “{g.says}”</p>
        {/if}
      </div>
    </li>
  {/each}
</ol>

<style>
  ol.gates {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li.gate {
    position: relative;
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 12px;
    padding-bottom: 14px;
    font-size: 0.9375rem;
    line-height: 1.45;
  }
  /* the track between gates */
  li.gate:not(:last-child)::before {
    content: '';
    position: absolute;
    left: 13px;
    top: 28px;
    bottom: 0;
    width: 2px;
    background: var(--line-strong);
  }
  li.gate[data-state='pass']:not(:last-child)::before {
    background: var(--success);
  }
  .mark {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--line-strong);
    background: var(--surface);
    font: 700 0.875rem/1 var(--font-sans);
    color: var(--ink-muted);
  }
  [data-state='pass'] .mark {
    border-color: var(--success);
    background: var(--success-soft);
    color: var(--success);
  }
  [data-state='stop'] .mark {
    border-color: var(--danger);
    background: var(--danger-soft);
    color: var(--danger);
  }
  [data-state='skip'] .mark {
    border-style: dashed;
  }
  .text {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding-top: 3px;
  }
  li.gate p {
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  li.gate p.q {
    font-weight: 650;
    color: var(--ink);
  }
  [data-state='skip'] p.q,
  [data-state='na'] p.q {
    color: var(--ink-muted);
    font-weight: 500;
  }
  .word {
    font-weight: 500;
    color: var(--ink-muted);
  }
  [data-state='pass'] .word {
    color: var(--success);
    font-weight: 650;
  }
  [data-state='stop'] .word {
    color: var(--danger);
    font-weight: 650;
  }
  li.gate p.says {
    margin-top: 4px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
    color: var(--ink);
    font-weight: 600;
  }
</style>
