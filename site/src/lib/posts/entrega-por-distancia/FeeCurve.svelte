<script lang="ts">
  import { DOORS, brl, feeCents, km1, roadKm, shownKm } from './model';
  import { sim } from './state.svelte';

  // Fee against road km with the same knobs as the map: one step per started km, the minimum's
  // plateau, the cut at the maximum. Before the cart's threshold, like Core's feeCents.
  const k = $derived(sim.knobs);
  const X = $derived(Math.min(14, Math.max(6, k.maxKm + 2)));
  const steps = $derived(
    Array.from({ length: Math.ceil(k.maxKm) }, (_, i) => {
      const n = i + 1;
      const fee = feeCents(k, n);
      return {
        from: i,
        to: Math.min(n, k.maxKm),
        fee,
        min: k.baseFeeCents + n * k.feePerKmCents < k.minFeeCents,
      };
    }),
  );
  const top = $derived(Math.max(500, ...steps.map((s) => s.fee)));
  const tick = $derived(top <= 2000 ? 500 : top <= 4000 ? 1000 : 2000);
  const Y = $derived(Math.ceil((top * 1.15) / tick) * tick);
  const yTicks = $derived(Array.from({ length: Y / tick + 1 }, (_, i) => i * tick));
  const xTicks = $derived(Array.from({ length: Math.floor(X / 2) + 1 }, (_, i) => i * 2));

  // drawing space: 100 × 60, stretched to the box; labels are HTML, placed in %
  const px = (km: number) => (km / X) * 100;
  const py = (c: number) => 60 - (c / Y) * 60;
  const left = (km: number) => `${(km / X) * 100}%`;
  const topPct = (c: number) => `${100 - (c / Y) * 100}%`;

  const plateau = $derived(steps.filter((s) => s.min));
  const plateauEnd = $derived(plateau.length ? plateau[plateau.length - 1]!.to : 0);

  const doorKm = $derived(shownKm(roadKm(sim.door)));
  const doorIn = $derived(doorKm <= k.maxKm);
  const doorFee = $derived(doorIn ? feeCents(k, doorKm) : 0);
  const doorName = $derived(DOORS.find((d) => d.id === sim.doorId)?.name ?? 'Porta');

  const summary = $derived(
    [
      plateau.length
        ? `Até ${plateauEnd} km, a taxa mínima de ${brl(k.minFeeCents)}.`
        : `No primeiro km, ${brl(feeCents(k, 1))}.`,
      k.feePerKmCents
        ? `Depois, mais ${brl(k.feePerKmCents)} a cada km começado.`
        : 'Sem valor por km, a taxa não muda com a distância.',
      `Em ${k.maxKm} km, ${brl(feeCents(k, k.maxKm))}. Mais longe, a loja não entrega.`,
    ].join(' '),
  );
</script>

<figure class="w" aria-label="Gráfico da taxa de entrega por quilômetro">
  <div class="chart" role="img" aria-label={summary}>
    <div class="plot">
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        {#each yTicks as t (t)}
          <line class="grid" x1="0" x2="100" y1={py(t)} y2={py(t)} />
        {/each}
        <rect class="out" x={px(k.maxKm)} y="0" width={100 - px(k.maxKm)} height="60" />
        <line class="cut" x1={px(k.maxKm)} x2={px(k.maxKm)} y1="0" y2="60" />
        {#each steps as s, i (i)}
          {#if i > 0}
            <line
              class="riser"
              x1={px(s.from)}
              x2={px(s.from)}
              y1={py(steps[i - 1]!.fee)}
              y2={py(s.fee)}
            />
          {/if}
          <line
            class="step"
            class:min={s.min}
            x1={px(s.from)}
            x2={px(s.to)}
            y1={py(s.fee)}
            y2={py(s.fee)}
          />
        {/each}
      </svg>

      {#each yTicks as t (t)}
        <span class="y" style="top:{topPct(t)}">{brl(t)}</span>
      {/each}
      {#each xTicks as t (t)}
        <span class="x" style="left:{left(t)}">{t} km</span>
      {/each}
      {#if plateau.length}
        <span class="note min-note" style="left:{left(plateauEnd / 2)};top:{topPct(k.minFeeCents)}"
          >mínima</span
        >
      {/if}
      <span class="note cut-note" style="left:{left((k.maxKm + X) / 2)};top:50%">não entrega</span>
      <span
        class="marker"
        class:outside={!doorIn}
        style="left:{left(Math.min(doorKm, X))};top:{doorIn ? topPct(doorFee) : '100%'}"
      ></span>
      <span
        class="note door-note"
        style="left:{left(Math.min(doorKm, X - 1))};top:{doorIn ? topPct(doorFee) : '100%'}"
        >{doorName}, {km1(doorKm)} km{doorIn ? `: ${brl(doorFee)}` : ''}</span
      >
    </div>
  </div>
  <figcaption aria-live="polite">
    {summary} A linha segue os mesmos valores do simulador acima; o ponto é a porta escolhida lá.
  </figcaption>
</figure>

<style>
  figure.w {
    display: grid;
    gap: 12px;
    margin: 12px 0;
    padding: 18px 14px 14px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .chart {
    padding: 8px 8px 28px 64px;
  }
  .plot {
    position: relative;
    height: clamp(180px, 42vw, 240px);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .out {
    fill: color-mix(in srgb, var(--danger) 10%, transparent);
  }
  .cut {
    stroke: var(--danger);
    stroke-width: 2px;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
  }
  .step {
    stroke: var(--ink);
    stroke-width: 3.5px;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .step.min {
    stroke: var(--success);
  }
  .riser {
    stroke: color-mix(in srgb, var(--ink) 35%, transparent);
    stroke-width: 1.5px;
    stroke-dasharray: 2 3;
    vector-effect: non-scaling-stroke;
  }
  .y,
  .x,
  .note,
  .marker {
    position: absolute;
    pointer-events: none;
  }
  .y {
    right: calc(100% + 8px);
    translate: 0 -50%;
    font: 500 0.75rem/1 var(--font-sans);
    color: var(--ink-muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .x {
    top: calc(100% + 8px);
    translate: -50% 0;
    font: 500 0.75rem/1 var(--font-sans);
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .note {
    translate: -50% calc(-100% - 6px);
    font: 600 0.75rem/1.3 var(--font-sans);
    white-space: nowrap;
  }
  .min-note {
    translate: -50% 8px;
    color: var(--success);
  }
  .cut-note {
    translate: -50% -50%;
    width: min-content;
    text-align: center;
    white-space: normal;
    color: var(--danger);
  }
  .door-note {
    translate: -50% calc(-100% - 12px);
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--surface);
  }
  .marker {
    width: 14px;
    height: 14px;
    translate: -50% -50%;
    border-radius: 50%;
    background: var(--danger);
    box-shadow: 0 0 0 3px var(--surface);
  }
  .marker.outside {
    border-radius: 3px;
    rotate: 45deg;
  }
  figure.w figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
</style>
