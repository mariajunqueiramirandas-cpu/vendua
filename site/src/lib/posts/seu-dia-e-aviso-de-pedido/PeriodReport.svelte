<script lang="ts">
  import { onMount } from 'svelte';
  import {
    brl,
    dateShort,
    delta,
    PERIODS,
    plural,
    rangeOf,
    span,
    spanDays,
    TODAY,
    totals,
    type Period,
  } from './data';

  // The top of Relatórios (apps/admin/src/features/reports/Reports.tsx) over the post's example
  // series: the same seven periods, Core's ranges and comparisons (routes-reports.ts presetRange:
  // the same number of days before, months against the month before), the same "vs. período
  // anterior" and the same summary under "Vendas por dia".
  let period = $state<Period>('7d');
  let from = $state('2026-09-01');
  let to = $state('2026-09-15');
  let live = $state(false);
  onMount(() => (live = true));

  /** custom ranges stay inside the example's months, with room for the period before */
  const MIN = '2026-08-01';
  const custom = $derived(from <= to ? { from, to } : { from: to, to: from });
  const r = $derived(rangeOf(period, custom));
  const cur = $derived(totals(r.from, r.to));
  const prev = $derived(totals(r.prevFrom, r.prevTo));
  const kpis = $derived([
    { label: 'Vendas', value: brl(cur.cents), d: delta(cur.cents, prev.cents) },
    { label: 'Pedidos', value: String(cur.orders), d: delta(cur.orders, prev.orders) },
    { label: 'Ticket médio', value: brl(cur.avg), d: delta(cur.avg, prev.avg) },
  ]);
  const bestDay = $derived([...cur.days].sort((a, b) => b.cents - a.cents)[0]);
  const summary = $derived(
    cur.orders
      ? `${brl(cur.cents)} em ${plural(cur.orders, 'pedido', 'pedidos')}. Melhor dia: ${bestDay && bestDay.cents ? `${dateShort(bestDay.date)} (${brl(bestDay.cents)})` : '—'}.`
      : 'Nada vendido nesse período.',
  );
  const top = $derived(Math.max(1, ...cur.days.map((d) => d.cents)));
  const days = $derived(spanDays(r.from, r.to));
</script>

<figure class="report">
  <div class="panel">
    <fieldset class="periods">
      <legend class="sr-only">Período do relatório</legend>
      {#each PERIODS as p (p.value)}
        <label class:on={period === p.value}>
          <input
            type="radio"
            name="report-period"
            value={p.value}
            checked={period === p.value}
            disabled={!live}
            onchange={() => (period = p.value)}
          />
          {p.label}
        </label>
      {/each}
    </fieldset>

    {#if period === 'custom'}
      <div class="dates">
        <label>
          de
          <input type="date" min={MIN} max={TODAY} bind:value={from} disabled={!live} />
        </label>
        <label>
          até
          <input type="date" min={MIN} max={TODAY} bind:value={to} disabled={!live} />
        </label>
      </div>
    {/if}

    <div class="out" aria-live="polite">
      <p class="range">
        <strong>{span(r.from, r.to)}</strong>, comparado com {span(r.prevFrom, r.prevTo)}
      </p>
      <dl class="kpis">
        {#each kpis as k (k.label)}
          <div>
            <dt>{k.label}</dt>
            <dd class="v tnum">{k.value}</dd>
            <dd class="d">
              {#if k.d === null}
                <span class="none">sem período anterior</span>
              {:else}
                <span class={k.d >= 0 ? 'good' : 'bad'}
                  >{k.d >= 0 ? '▲' : '▼'} {Math.abs(k.d)}%</span
                >
                <span class="none">vs. período anterior</span>
              {/if}
            </dd>
          </div>
        {/each}
      </dl>
      <p class="chart-title">Vendas por dia</p>
      <p class="summary">{summary}</p>
    </div>
    <div class="cols" class:dense={days > 14} aria-hidden="true">
      {#each cur.days as d (d.date)}
        <span
          class="c"
          class:today={d.date === TODAY}
          style="--v: {d.cents / top}"
          title="{dateShort(d.date)}: {brl(d.cents)}"
        ></span>
      {/each}
    </div>
  </div>
  <figcaption>
    Exemplo com a Bolos da Nena, com dados inventados para os meses antes desta semana. Os períodos
    e as comparações seguem as regras do relatório da Venduá; os 7 dias batem com a tela de
    relatórios.
  </figcaption>
</figure>

<style>
  figure.report {
    margin: 12px 0;
    display: grid;
    gap: 14px;
  }
  .panel {
    display: grid;
    gap: 18px;
    padding: 20px 18px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  figure.report p,
  figure.report dd,
  figure.report dt {
    margin: 0;
  }
  .periods {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .periods label {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--ink);
    font: 600 0.875rem/1 var(--font-sans);
    cursor: pointer;
  }
  .periods label:hover {
    background: var(--hover);
  }
  .periods label.on {
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: none;
  }
  .periods input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .periods label:has(input:focus-visible),
  .dates input:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .dates {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .dates label {
    display: grid;
    gap: 4px;
    color: var(--ink-muted);
    font: 600 0.8125rem/1.2 var(--font-sans);
  }
  .dates input {
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    font: 500 1rem/1 var(--font-sans);
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    .dates input {
      color-scheme: dark;
    }
  }
  .out {
    display: grid;
    gap: 14px;
  }
  figure.report .range {
    font-size: 0.9375rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  figure.report .range strong {
    color: var(--ink);
  }
  .kpis {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    margin: 0;
  }
  .kpis div {
    display: grid;
    align-content: start;
    gap: 2px;
    min-width: 0;
  }
  .kpis dt {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .kpis .v {
    font: 600 1.375rem/1.2 var(--font-display);
    letter-spacing: -0.02em;
    color: var(--ink);
    white-space: nowrap;
  }
  .kpis .d {
    font-size: 0.8125rem;
    line-height: 1.35;
  }
  .good {
    font-weight: 700;
    color: var(--success);
  }
  .bad {
    font-weight: 700;
    color: var(--danger);
  }
  .none {
    color: var(--ink-muted);
  }
  figure.report .chart-title {
    margin-top: 4px;
    font: 600 1rem/1.3 var(--font-display);
    color: var(--ink);
  }
  figure.report .summary {
    margin-top: -10px;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  .cols {
    display: flex;
    align-items: flex-end;
    justify-content: space-around;
    gap: 4px;
    height: 96px;
    border-bottom: 1.5px solid var(--line-strong);
  }
  .cols.dense {
    gap: 1px;
  }
  .c {
    flex: 1;
    max-width: 48px;
    height: max(2px, calc(var(--v) * 100%));
    border-radius: 3px 3px 0 0;
    background: color-mix(in srgb, var(--ink) 30%, transparent);
  }
  .c.today {
    background: var(--primary);
  }
  figure.report figcaption {
    max-width: none;
  }
  /* a narrow phone: one figure per line, its comparison beside it */
  @media (max-width: 559px) {
    .kpis div {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: baseline;
      column-gap: 12px;
    }
    .kpis dt {
      grid-column: 1 / -1;
    }
    .kpis .d {
      text-align: right;
    }
  }
  @media (min-width: 560px) {
    .panel {
      padding: 26px 28px;
    }
    .kpis {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
