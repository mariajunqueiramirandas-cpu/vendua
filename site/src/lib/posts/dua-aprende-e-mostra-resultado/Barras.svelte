<script lang="ts">
  import type { Bar } from './dados';
  import { brl, brlShort } from './money';

  // Closed (solid) and assisted (striped) per day or per hour, one stack per bar with a gap between
  // the two so they read as two things. Pointer or arrow keys pick a bar; the readout says it.
  let { bars, tick, unit }: { bars: Bar[]; tick: (i: number) => boolean; unit: 'hora' | 'dia' } =
    $props();

  let sel = $state<number | null>(null);
  const top = $derived.by(() => {
    const max = Math.max(1, ...bars.map((b) => b.closed + b.assisted));
    const step = max > 60000 ? 20000 : max > 20000 ? 10000 : 5000;
    return Math.ceil(max / step) * step;
  });
  const shown = $derived(sel === null ? null : bars[sel]);
  const pct = (c: number) => `${(c / top) * 100}%`;

  function key(e: KeyboardEvent) {
    const last = bars.length - 1;
    if (e.key === 'ArrowRight') sel = sel === null ? last : Math.min(last, sel + 1);
    else if (e.key === 'ArrowLeft') sel = sel === null ? last : Math.max(0, sel - 1);
    else if (e.key === 'Home') sel = 0;
    else if (e.key === 'End') sel = last;
    else if (e.key === 'Escape') sel = null;
    else return;
    e.preventDefault();
  }
</script>

<div class="chart">
  <div class="plot">
    <div class="grid" aria-hidden="true">
      <span style:bottom="100%"><i>{brlShort(top)}</i></span>
      <span style:bottom="50%"><i>{brlShort(top / 2)}</i></span>
      <span style:bottom="0%"><i>R$ 0</i></span>
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="bars"
      class:dense={bars.length > 12}
      role="group"
      tabindex="0"
      aria-label="Barras por {unit}: use as setas para ler cada uma"
      onkeydown={key}
      onpointerleave={() => (sel = null)}
      onblur={() => (sel = null)}
    >
      {#each bars as b, i (b.long)}
        <div
          class="col"
          class:on={sel === i}
          onpointerenter={() => (sel = i)}
          onpointerdown={() => (sel = i)}
          aria-hidden="true"
        >
          <div class="stack">
            {#if b.assisted}<span class="seg helped" style:height={pct(b.assisted)}></span>{/if}
            {#if b.closed}<span class="seg closed" style:height={pct(b.closed)}></span>{/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
  <div class="axis" class:dense={bars.length > 12} aria-hidden="true">
    {#each bars as b, i (b.long)}
      <span>{tick(i) ? b.label : ''}</span>
    {/each}
  </div>
  <p class="readout tnum" aria-live="polite">
    {#if shown}
      <strong>{shown.long}:</strong> fechou {brl(shown.closed)}, ajudou {brl(shown.assisted)}
    {:else}
      Toque ou passe o mouse numa barra para ver cada {unit}.
    {/if}
  </p>
  <div class="sr">
    <table>
      <caption>Fechado pelo Duá e ajudado por ele, em reais</caption>
      <thead><tr><th>quando</th><th>fechou</th><th>ajudou</th></tr></thead>
      <tbody>
        {#each bars as b (b.long)}
          <tr><td>{b.long}</td><td>{brl(b.closed)}</td><td>{brl(b.assisted)}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .chart {
    position: relative;
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .plot {
    position: relative;
    height: 180px;
    margin-left: 64px;
  }
  .grid span {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: 1px dashed var(--line-strong);
  }
  .grid span:last-child {
    border-top-style: solid;
  }
  .grid i {
    position: absolute;
    right: calc(100% + 8px);
    top: -0.6em;
    font-style: normal;
    font-size: 0.75rem;
    line-height: 1.2;
    white-space: nowrap;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .bars {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: stretch;
    gap: 6px;
    border-radius: 4px;
    touch-action: pan-y;
  }
  .bars.dense {
    gap: 2px;
  }
  .bars:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 6px;
  }
  .col {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: flex-end;
    border-radius: 4px 4px 0 0;
  }
  .col.on {
    background: var(--hover);
  }
  .stack {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 2px;
  }
  .seg {
    display: block;
    width: 100%;
    flex: none;
  }
  .seg:first-child {
    border-radius: 4px 4px 0 0;
  }
  .closed {
    background: var(--primary);
  }
  .helped {
    background: repeating-linear-gradient(135deg, var(--info) 0 2px, var(--info-soft) 2px 5px);
    box-shadow: inset 0 0 0 1px var(--info);
  }
  .col.on .closed {
    background: color-mix(in srgb, var(--primary) 82%, var(--ink-muted));
  }
  .axis {
    display: flex;
    gap: 6px;
    margin-left: 64px;
    font-size: 0.75rem;
    line-height: 1.2;
    color: var(--ink-muted);
  }
  .axis.dense span:last-child {
    justify-content: flex-end;
  }
  .axis.dense {
    gap: 2px;
  }
  .axis span {
    flex: 1 1 0;
    min-width: 0;
    text-align: center;
    white-space: nowrap;
    overflow: visible;
    display: flex;
    justify-content: center;
  }
  .chart p.readout {
    min-height: 2.75em;
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .chart p.readout strong {
    color: var(--ink);
    font-weight: 600;
  }
  .sr {
    position: absolute;
    left: 0;
    top: 0;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
