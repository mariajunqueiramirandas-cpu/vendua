<script lang="ts">
  import { brl } from './model';
  import { sim } from './state.svelte';

  // The five fields of the admin's "Cobrar pela distância" card, as sliders. Ranges are the
  // simulation's (the map is 14 km wide); the app's own limits are in the post.
  const minText = $derived(sim.knobs.minFeeCents ? brl(sim.knobs.minFeeCents) : 'sem mínima');
  const freeText = $derived(sim.knobs.freeOverCents ? brl(sim.knobs.freeOverCents) : 'desligado');
</script>

<div class="knobs">
  <div class="knob">
    <label for="edd-base">Taxa de saída</label>
    <output for="edd-base" class="tnum">{brl(sim.knobs.baseFeeCents)}</output>
    <input
      id="edd-base"
      type="range"
      min="0"
      max="1500"
      step="50"
      bind:value={sim.knobs.baseFeeCents}
      aria-valuetext={brl(sim.knobs.baseFeeCents)}
    />
  </div>
  <div class="knob">
    <label for="edd-km">Por km</label>
    <output for="edd-km" class="tnum">{brl(sim.knobs.feePerKmCents)}</output>
    <input
      id="edd-km"
      type="range"
      min="0"
      max="500"
      step="10"
      bind:value={sim.knobs.feePerKmCents}
      aria-valuetext="{brl(sim.knobs.feePerKmCents)} por quilômetro"
    />
  </div>
  <div class="knob">
    <label for="edd-min">Taxa mínima</label>
    <output for="edd-min" class="tnum">{minText}</output>
    <input
      id="edd-min"
      type="range"
      min="0"
      max="2000"
      step="50"
      bind:value={sim.knobs.minFeeCents}
      aria-valuetext={minText}
    />
  </div>
  <div class="knob">
    <label for="edd-max">Entrega até</label>
    <output for="edd-max" class="tnum">{sim.knobs.maxKm} km</output>
    <input
      id="edd-max"
      type="range"
      min="1"
      max="12"
      step="1"
      bind:value={sim.knobs.maxKm}
      aria-valuetext="{sim.knobs.maxKm} quilômetros"
    />
  </div>
  <div class="knob wide">
    <label for="edd-free">A loja paga a entrega a partir de</label>
    <output for="edd-free" class="tnum">{freeText}</output>
    <input
      id="edd-free"
      type="range"
      min="0"
      max="30000"
      step="1000"
      value={sim.knobs.freeOverCents ?? 0}
      oninput={(e) => {
        const v = Number(e.currentTarget.value);
        sim.knobs.freeOverCents = v > 0 ? v : null;
      }}
      aria-valuetext={freeText}
    />
  </div>
</div>

<style>
  .knobs {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 4px 24px;
  }
  @media (min-width: 560px) {
    .knobs {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .wide {
      grid-column: 1 / -1;
    }
  }
  .knob {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 0 12px;
  }
  .knob label {
    font: 600 0.9375rem/1.4 var(--font-sans);
    color: var(--ink);
  }
  .knob output {
    font: 600 0.9375rem/1.4 var(--font-display);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  input[type='range'] {
    grid-column: 1 / -1;
    width: 100%;
    height: 44px;
    margin: 0;
    background: transparent;
    accent-color: var(--ink);
    cursor: pointer;
  }
  input[type='range']:focus-visible {
    outline: 3px solid var(--ink);
    outline-offset: -6px;
    border-radius: 12px;
  }
</style>
