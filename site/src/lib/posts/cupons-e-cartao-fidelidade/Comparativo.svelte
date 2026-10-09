<script lang="ts">
  import { brl, FEE } from './rules';

  // Three coupons against the same delivery order as the bag grows: how much each one takes off
  // (Core's arithmetic: 10% rounds down to the cent, R$ 10 never goes past the items, the delivery
  // coupon takes exactly the fee). The plot is stretched SVG; labels are HTML so they never scale.

  const MAX = 20000; // R$ 200 of items
  const YMAX = 2000; // R$ 20 off
  let sub = $state(11200); // + R$ 8 of delivery = R$ 120, Nena's average ticket

  const SERIES = [
    {
      id: 'pct',
      name: '10% de desconto',
      tag: '10%',
      off: (s: number) => Math.floor((s * 10) / 100),
      pts: `0,1000 1000,0`,
    },
    {
      id: 'fix',
      name: 'R$ 10,00 de desconto',
      tag: 'R$ 10 fixo',
      off: (s: number) => Math.min(1000, s),
      pts: `0,1000 50,500 1000,500`,
    },
    {
      id: 'ent',
      name: 'Cupom que zera a entrega',
      tag: 'Zera a entrega',
      off: () => FEE,
      pts: `0,600 1000,600`,
    },
  ] as const;

  const x = (cents: number) => (cents / MAX) * 100;
  const y = (cents: number) => 100 - (cents / YMAX) * 100;
  const rows = $derived(
    SERIES.map((s) => {
      const off = s.off(sub);
      return { ...s, off, pays: sub + FEE - off };
    }),
  );
  const best = $derived(Math.max(...rows.map((r) => r.off)));

  let plot = $state<HTMLDivElement>();
  const follow = (e: PointerEvent) => {
    if (!plot) return;
    const r = plot.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    sub = Math.max(1000, Math.round((f * MAX) / 50) * 50);
  };
</script>

<figure class="comp" aria-labelledby="comp-cap">
  <p class="title">Quanto cada cupom tira do pedido, conforme a sacola cresce</p>

  <div class="chart">
    <div class="yaxis" aria-hidden="true">
      {#each [0, 500, 1000, 1500, 2000] as t (t)}
        <span style="top: {y(t)}%">{t ? `R$ ${t / 100}` : 'R$ 0'}</span>
      {/each}
    </div>
    <div
      class="plot"
      bind:this={plot}
      onpointermove={follow}
      onpointerdown={follow}
      role="presentation"
    >
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        {#each [500, 1000, 1500] as t (t)}
          <line class="grid" x1="0" x2="1000" y1={y(t) * 10} y2={y(t) * 10} />
        {/each}
        <line class="base" x1="0" x2="1000" y1="1000" y2="1000" />
        {#each SERIES as s (s.id)}
          <polyline class="line {s.id}" points={s.pts} />
        {/each}
        <line class="cursor" x1={x(sub) * 10} x2={x(sub) * 10} y1="0" y2="1000" />
      </svg>
      <!-- where 10% catches up with the delivery (R$ 80) and with R$ 10 (R$ 100) -->
      <span class="cross" style="left: {x(8000)}%; top: {y(800)}%" aria-hidden="true"></span>
      <span class="cross" style="left: {x(10000)}%; top: {y(1000)}%" aria-hidden="true"></span>
      {#each rows as r (r.id)}
        <span class="dot {r.id}" style="left: {x(sub)}%; top: {y(r.off)}%" aria-hidden="true"
        ></span>
      {/each}
    </div>
    <div class="tags" aria-hidden="true">
      <span class="tag pct" style="top: {y(2000)}%">10%</span>
      <span class="tag fix" style="top: {y(1000)}%">R$ 10 fixo</span>
      <span class="tag ent" style="top: {y(800)}%">Zera a entrega</span>
    </div>
    <div class="xaxis" aria-hidden="true">
      {#each [0, 5000, 10000, 15000, 20000] as t (t)}
        <span class:minor={t === 5000 || t === 15000} style="left: {x(t)}%">R$ {t / 100}</span>
      {/each}
    </div>
  </div>

  <div class="control">
    <label for="comp-sub">Itens na sacola <output class="v">{brl(sub)}</output></label>
    <input
      id="comp-sub"
      type="range"
      min="1000"
      max={MAX}
      step="50"
      bind:value={sub}
      aria-valuetext="{brl(sub)} em itens"
    />
    <p class="base-line">
      Com a entrega de {brl(FEE)}, o pedido dá <strong>{brl(sub + FEE)}</strong> sem cupom.
    </p>
  </div>

  <ul class="bars" aria-live="polite">
    {#each rows as r (r.id)}
      <li class="bar-row">
        <p class="name">
          <svg class="swatch" viewBox="0 0 28 8" aria-hidden="true">
            <line class="line {r.id}" x1="2" x2="26" y1="4" y2="4" />
          </svg>
          {r.name}
          {#if r.off === best}<span class="best">maior desconto aqui</span>{/if}
        </p>
        <div class="bar" aria-hidden="true">
          <span class="pays" style="flex-basis: {(r.pays / (sub + FEE)) * 100}%"></span>
          <span class="off {r.id}" style="flex-basis: {(r.off / (sub + FEE)) * 100}%"></span>
        </div>
        <p class="nums">
          O cliente paga <strong>{brl(r.pays)}</strong> e a loja abre mão de
          <strong>{brl(r.off)}</strong>.
        </p>
      </li>
    {/each}
  </ul>

  <figcaption id="comp-cap">
    Exemplo com um pedido de entrega de {brl(FEE)} na Bolos da Nena. Os descontos saem da conta da Venduá:
    10% arredonda para baixo, no centavo, e o valor fixo nunca passa do valor dos itens. Os círculos marcam
    os empates: em {brl(8000)} de itens, 10% empata com a entrega; em {brl(10000)}, com os R$ 10.
  </figcaption>
</figure>

<style>
  figure.comp {
    --paper: var(--surface);
    --c-pct: var(--primary);
    --c-fix: var(--info);
    --c-ent: var(--warning);
    display: grid;
    gap: 16px;
    margin: 12px 0;
    padding: 20px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--paper);
    box-shadow: var(--shadow-e1);
  }
  @media (min-width: 480px) {
    figure.comp {
      padding: 24px;
    }
  }
  figure.comp p.title {
    font: 600 1.0625rem/1.35 var(--font-display);
    color: var(--ink);
  }

  .chart {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) 92px;
    grid-template-rows: 200px 28px;
  }
  @media (min-width: 480px) {
    .chart {
      grid-template-rows: 240px 28px;
      grid-template-columns: 44px minmax(0, 1fr) 104px;
    }
  }
  .yaxis,
  .tags {
    position: relative;
  }
  .yaxis span,
  .tags span,
  .xaxis span {
    position: absolute;
    font-size: 0.75rem;
    line-height: 1;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .yaxis span {
    right: 8px;
    transform: translateY(-50%);
  }
  .tags span {
    left: 8px;
    transform: translateY(-50%);
    font-size: 0.8125rem;
    font-weight: 650;
    color: var(--ink);
  }
  .xaxis {
    position: relative;
    grid-column: 2;
  }
  .xaxis span {
    top: 10px;
    transform: translateX(-50%);
  }
  .xaxis span:first-child {
    transform: none;
  }
  .xaxis span:last-child {
    transform: translateX(-100%);
  }

  .plot {
    position: relative;
    touch-action: pan-y;
    cursor: crosshair;
  }
  .plot svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .base {
    stroke: var(--line-strong);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .line {
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .line.pct {
    stroke: var(--c-pct);
  }
  .line.fix {
    stroke: var(--c-fix);
    stroke-dasharray: 7 5;
  }
  .line.ent {
    stroke: var(--c-ent);
    stroke-dasharray: 1 6;
    stroke-width: 3;
  }
  .cursor {
    stroke: var(--ink-muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
  }
  .dot {
    position: absolute;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--paper);
  }
  .dot.pct {
    background: var(--c-pct);
  }
  .dot.fix {
    background: var(--c-fix);
  }
  .dot.ent {
    background: var(--c-ent);
  }
  .cross {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border: 2px solid var(--ink-muted);
    border-radius: 50%;
    background: var(--paper);
    pointer-events: none;
  }
  @media (max-width: 479px) {
    .xaxis span.minor {
      display: none;
    }
  }

  .control {
    display: grid;
    gap: 4px;
  }
  .control label {
    display: flex;
    justify-content: space-between;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
  }
  .v {
    font-variant-numeric: tabular-nums;
  }
  .control input {
    width: 100%;
    min-height: 44px;
    margin: 0;
    accent-color: var(--primary);
  }
  figure.comp p.base-line {
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }

  ul.bars {
    display: grid;
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li.bar-row {
    display: grid;
    gap: 6px;
  }
  figure.comp p.name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    font-size: 0.9375rem;
    line-height: 1.35;
    font-weight: 650;
    color: var(--ink);
  }
  .swatch {
    width: 28px;
    height: 8px;
    overflow: visible;
  }
  .best {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--spark-soft);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .bar {
    display: flex;
    gap: 2px;
    height: 14px;
  }
  .bar span {
    min-width: 0;
    border-radius: 3px;
    transition: flex-basis var(--duration-quick) var(--ease-soft);
  }
  .pays {
    background: color-mix(in srgb, var(--ink) 16%, transparent);
  }
  .off.pct {
    background: var(--c-pct);
  }
  .off.fix {
    background: repeating-linear-gradient(
      135deg,
      var(--c-fix) 0 5px,
      color-mix(in srgb, var(--c-fix) 55%, var(--paper)) 5px 8px
    );
  }
  .off.ent {
    background: repeating-linear-gradient(
      90deg,
      var(--c-ent) 0 3px,
      color-mix(in srgb, var(--c-ent) 45%, var(--paper)) 3px 5px
    );
  }
  figure.comp p.nums {
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  figure.comp figcaption {
    max-width: none;
    text-align: left;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar span {
      transition: none;
    }
  }
</style>
