<script lang="ts">
  import {
    avgTicketCents,
    best,
    brl,
    brlShort,
    busiest,
    CLOSE,
    dateShort,
    HOURS,
    lastWeek,
    OPEN,
    orders,
    plural,
    salesCents,
    TODAY,
    vsLastWeek,
    WEEK,
    weekday,
  } from './data';

  // Bolos da Nena's Tuesday as "Seu dia" adds it up (apps/admin/src/features/home/Home.tsx and
  // Core's routes-home.ts): the day's sales, orders, average ticket, best seller, the hour with the
  // most orders and the same weekday last week up to the same hour. Under it, the day hour by hour
  // beneath the sun's path (drag or use the arrow keys to move the sun) and the last 7 days.

  let hour = $state<number>(busiest.hour);
  let day = $state(WEEK.length - 1);

  const hourMax = Math.max(...HOURS.map((h) => h.cents));
  const weekMax = Math.max(...WEEK.map((d) => d.cents), lastWeek.cents);
  const cols = HOURS.length;

  /** where the sun sits on the drawn half-ellipse, for the middle of the chosen hour */
  const sun = $derived.by(() => {
    const t = (hour + 0.5 - OPEN) / cols;
    return { x: t * 100, y: (1 - 2 * Math.sqrt(t * (1 - t))) * 100 };
  });
  const sel = $derived(HOURS.find((h) => h.hour === hour)!);
  const hourText = $derived(
    sel.orders
      ? `${hour}h: ${plural(sel.orders, 'pedido', 'pedidos')}, ${brl(sel.cents)}${hour === busiest.hour ? '. A hora mais movimentada.' : '.'}`
      : `${hour}h: nenhum pedido.`,
  );

  const dayText = $derived.by(() => {
    const d = WEEK[day]!;
    const head = d.date === TODAY ? `Hoje, ${dateShort(d.date)}` : dateShort(d.date);
    const what = d.orders
      ? `${brl(d.cents)} em ${plural(d.orders, 'pedido', 'pedidos')}`
      : 'nenhum pedido';
    return d.date === TODAY
      ? `${head}: ${what}. Na terça passada, até esta hora: ${brl(lastWeek.cents)} em ${plural(lastWeek.orders, 'pedido', 'pedidos')}.`
      : `${head}: ${what}.`;
  });

  let chart: HTMLDivElement | undefined = $state();
  function fromPointer(e: PointerEvent) {
    if (!chart) return;
    const r = chart.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / r.width) * cols);
    hour = OPEN + Math.min(cols - 1, Math.max(0, i));
  }
  function onKey(e: KeyboardEvent) {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
    };
    if (e.key in step) hour = Math.min(CLOSE - 1, Math.max(OPEN, hour + step[e.key]!));
    else if (e.key === 'Home') hour = OPEN;
    else if (e.key === 'End') hour = CLOSE - 1;
    else return;
    e.preventDefault();
  }
  const ticks = [8, 10, 12, 14, 16, 18, 20];
</script>

<figure class="recap">
  <div class="card">
    <div class="head">
      <p class="label">Seu dia, terça, 29 de setembro</p>
      <p class="total tnum">{brl(salesCents)}</p>
      <p class="vs">
        <span class="up">▲ {vsLastWeek}%</span> vs. o mesmo dia da semana passada, até esta hora
      </p>
    </div>

    <dl class="facts">
      <div>
        <dt>Pedidos</dt>
        <dd class="tnum">{orders}</dd>
      </div>
      <div>
        <dt>Ticket médio</dt>
        <dd class="tnum">{brlShort(avgTicketCents)}</dd>
      </div>
      <div>
        <dt>Hora mais movimentada</dt>
        <dd class="tnum">{busiest.hour}h</dd>
      </div>
      <div class="wide">
        <dt>Campeão</dt>
        <dd>{best.name} <span class="qty">({best.qty})</span></dd>
      </div>
    </dl>

    <div class="block">
      <p class="chart-title" id="recap-hours">O dia, hora a hora</p>
      <div class="sky" aria-hidden="true">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none">
          <path d="M0 40 A50 40 0 0 1 100 40" vector-effect="non-scaling-stroke" />
        </svg>
        <span class="sun" style="left: {sun.x}%; top: {sun.y}%"></span>
      </div>
      <div
        class="hours"
        bind:this={chart}
        role="slider"
        tabindex="0"
        aria-labelledby="recap-hours"
        aria-valuemin={OPEN}
        aria-valuemax={CLOSE - 1}
        aria-valuenow={hour}
        aria-valuetext={hourText}
        onkeydown={onKey}
        onpointerdown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onpointermove={(e) => {
          if (e.pointerType === 'mouse' || e.buttons) fromPointer(e);
        }}
      >
        {#each HOURS as h (h.hour)}
          <div class="col" class:on={h.hour === hour}>
            {#if h.orders}<span class="count tnum">{h.orders}</span>{/if}
            <span class="bar" style="--v: {h.cents / hourMax}"></span>
          </div>
        {/each}
      </div>
      <div class="axis" aria-hidden="true">
        {#each ticks as t (t)}
          <span style="left: {((t - OPEN) / cols) * 100}%">{t}h</span>
        {/each}
      </div>
      <p class="readout tnum" aria-live="polite">{hourText}</p>
    </div>

    <div class="block">
      <p class="chart-title">Os últimos 7 dias</p>
      <div class="week">
        {#each WEEK as d, i (d.date)}
          {@const today = d.date === TODAY}
          <button
            type="button"
            class="wcol"
            class:on={i === day}
            aria-pressed={i === day}
            aria-label="{dateShort(d.date)}: {d.orders ? brl(d.cents) : 'nenhum pedido'}"
            onclick={() => (day = i)}
            onfocus={() => (day = i)}
            onpointerenter={(e) => e.pointerType === 'mouse' && (day = i)}
          >
            <span class="wbars" aria-hidden="true">
              {#if today}<span class="ghost" style="--v: {lastWeek.cents / weekMax}"></span>{/if}
              <span class="wbar" class:today style="--v: {d.cents / weekMax}"></span>
            </span>
            <span class="wday" aria-hidden="true">{weekday(d.date)}</span>
            <span class="wnum tnum" aria-hidden="true">{Number(d.date.slice(8))}</span>
          </button>
        {/each}
      </div>
      <p class="key">
        <span class="swatch" aria-hidden="true"></span>A barra tracejada é a terça passada, até esta
        hora.
      </p>
      <p class="readout tnum" aria-live="polite">{dayText}</p>
    </div>
  </div>
  <figcaption>
    Exemplo com a Bolos da Nena, os mesmos números da tela acima. As contas são as da Venduá: o
    ticket médio é {brl(salesCents)} dividido por {orders} pedidos, e os {vsLastWeek}% comparam com
    os
    {brl(lastWeek.cents)} da terça anterior.
  </figcaption>
</figure>

<style>
  figure.recap {
    margin: 12px 0;
    display: grid;
    gap: 14px;
  }
  .card {
    display: grid;
    gap: 26px;
    padding: 22px 18px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-e1);
  }
  figure.recap p,
  figure.recap dd,
  figure.recap dt {
    margin: 0;
  }
  figure.recap .label,
  figure.recap .chart-title {
    font: 600 0.9375rem/1.3 var(--font-sans);
    color: var(--ink-muted);
  }
  figure.recap .total {
    margin-top: 4px;
    font: 600 clamp(2.5rem, 2rem + 2.4vw, 3.25rem) / 1 var(--font-display);
    letter-spacing: -0.04em;
    color: var(--ink);
  }
  figure.recap .vs {
    margin-top: 8px;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  .up {
    font-weight: 700;
    color: var(--success);
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px 12px;
    margin: 0;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }
  .facts .wide {
    grid-column: 1 / -1;
  }
  .facts dt {
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--ink-muted);
  }
  .facts dd {
    margin-top: 4px;
    font: 600 1.5rem/1.15 var(--font-display);
    color: var(--ink);
  }
  .facts .wide dd {
    font-size: 1.1875rem;
    line-height: 1.3;
  }
  .qty {
    color: var(--ink-muted);
    font-weight: 500;
  }

  .block {
    display: grid;
    gap: 8px;
  }
  /* the sun's path from opening to closing: the day's arc over its hours */
  .sky {
    position: relative;
    height: 56px;
    margin: 6px 0 4px;
  }
  .sky svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .sky path {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 1.5;
    stroke-dasharray: 3 5;
  }
  .sun {
    position: absolute;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: var(--warning-soft);
    box-shadow:
      inset 0 0 0 2px var(--warning),
      0 0 0 6px color-mix(in srgb, var(--warning) 14%, transparent);
    transition:
      left var(--duration-smooth) var(--ease-soft),
      top var(--duration-smooth) var(--ease-soft);
  }
  .hours {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 3px;
    height: 120px;
    border-bottom: 1.5px solid var(--line-strong);
    cursor: ew-resize;
    touch-action: pan-y;
    border-radius: 4px 4px 0 0;
  }
  .hours:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 6px;
  }
  .col {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    gap: 4px;
    border-radius: 6px 6px 0 0;
  }
  .col.on {
    background: var(--hover);
  }
  .count {
    font: 600 0.8125rem/1 var(--font-sans);
    color: var(--ink-muted);
  }
  .col.on .count {
    color: var(--ink);
  }
  .bar {
    width: 100%;
    max-width: 30px;
    height: calc(var(--v) * 88px);
    border-radius: 5px 5px 0 0;
    background: color-mix(in srgb, var(--ink) 26%, transparent);
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .col.on .bar {
    background: var(--primary);
  }
  .axis {
    position: relative;
    height: 18px;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .axis span {
    position: absolute;
    top: 2px;
    transform: translateX(-50%);
    font-variant-numeric: tabular-nums;
  }
  .axis span:first-child {
    transform: none;
  }
  .axis span:last-child {
    transform: translateX(-100%);
  }
  figure.recap .readout {
    min-height: 3em;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink);
  }

  .week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 2px;
    margin-top: 4px;
  }
  .wcol {
    display: grid;
    grid-template-rows: 112px auto auto;
    justify-items: center;
    gap: 2px;
    min-width: 0;
    padding: 6px 0 6px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--ink-muted);
    font: 500 0.8125rem/1.2 var(--font-sans);
    cursor: pointer;
  }
  .wcol:hover,
  .wcol.on {
    background: var(--hover);
    color: var(--ink);
  }
  .wcol:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }
  .wbars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 100%;
    border-bottom: 1.5px solid var(--line-strong);
    padding: 0 4px;
  }
  .wbar,
  .ghost {
    width: 18px;
    height: max(2px, calc(var(--v) * 100%));
    border-radius: 4px 4px 0 0;
  }
  .wbar {
    background: color-mix(in srgb, var(--ink) 26%, transparent);
  }
  .wbar.today {
    background: var(--primary);
  }
  .ghost {
    width: 10px;
    border: 1.5px dashed var(--ink-muted);
    border-bottom: 0;
  }
  .wcol.on .wbar:not(.today) {
    background: color-mix(in srgb, var(--ink) 55%, transparent);
  }
  .wday {
    margin-top: 4px;
    font-weight: 600;
  }
  figure.recap .key {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .swatch {
    width: 14px;
    height: 12px;
    border: 1.5px dashed var(--ink-muted);
    border-bottom: 0;
    border-radius: 3px 3px 0 0;
  }
  figure.recap figcaption {
    max-width: none;
  }

  @media (min-width: 560px) {
    .card {
      padding: 28px;
    }
    .facts {
      grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.6fr);
    }
    .facts .wide {
      grid-column: auto;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sun,
    .bar {
      transition: none;
    }
  }
</style>
