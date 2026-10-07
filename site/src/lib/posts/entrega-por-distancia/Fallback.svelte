<script lang="ts">
  import {
    DETOUR_FACTOR,
    DOORS,
    ESTIMATE_KMH,
    PREP_MINUTES,
    STORE,
    brl,
    km1,
    quote,
    roadKm,
    shownKm,
    straightKm,
  } from './model';
  import { sim } from './state.svelte';

  // The three distances for each sample door, and which one Core charges: the road route when the
  // routing service answered, else the straight line × 1,3, marked as an estimate (geo.ts
  // priceByDistance). The estimate's time is the store's prep plus the drive at 25 km/h.
  let routed = $state(true);

  const rows = $derived(
    DOORS.map((d) => {
      const straight = straightKm(STORE, d.at);
      const estimate = straight * DETOUR_FACTOR;
      const road = roadKm(d.at);
      const used = routed ? road : estimate;
      const q = quote(sim.knobs, used, 0);
      const drive = Math.ceil((shownKm(estimate) / ESTIMATE_KMH) * 60);
      const eta = PREP_MINUTES + drive;
      return {
        d,
        straight,
        estimate,
        road,
        q,
        eta: `${eta}–${eta + Math.max(10, Math.ceil(drive / 2))} min`,
      };
    }),
  );
  const S = 11;
  const w = (km: number) => `${(Math.min(km, S) / S) * 100}%`;
</script>

<figure class="w" aria-label="Caminho de carro e estimativa em linha reta">
  <div class="switch" role="group" aria-label="Serviço de rotas">
    <button type="button" aria-pressed={routed} onclick={() => (routed = true)}>
      O caminho de carro respondeu
    </button>
    <button type="button" aria-pressed={!routed} onclick={() => (routed = false)}>
      O serviço de rotas não respondeu
    </button>
  </div>

  <ul class="rows" aria-live="polite">
    {#each rows as r (r.d.id)}
      <li>
        <p class="who"><strong>{r.d.name}</strong> {r.d.where}</p>
        <div class="bars" aria-hidden="true">
          <span class="bar straight" style="width:{w(r.straight)}"></span>
          <span class="bar estimate" class:used={!routed} style="width:{w(r.estimate)}"></span>
          <span class="bar road" class:used={routed} style="width:{w(r.road)}"></span>
          <span class="max" style="left:{w(sim.knobs.maxKm)}"></span>
        </div>
        <p class="nums tnum">
          <span>linha reta {km1(r.straight)} km</span>
          <span class:on={!routed}>× 1,3 = {km1(r.estimate)} km</span>
          <span class:on={routed}>caminho {km1(r.road)} km</span>
        </p>
        <p class="charged">
          {#if r.q.ok}
            {#if routed}
              Cobra {km1(r.q.km)} km: <strong class="tnum">{brl(r.q.fee)}</strong>
            {:else}
              Cobra cerca de {km1(r.q.km)} km: <strong class="tnum">{brl(r.q.fee)}</strong>
              <span class="tag">estimativa</span>
              <span class="eta">chega em {r.eta}</span>
            {/if}
          {:else}
            {km1(r.q.km)} km passa dos {sim.knobs.maxKm} km: <strong>fora da área</strong>
          {/if}
        </p>
      </li>
    {/each}
  </ul>

  <figcaption>
    Simulação com a Bolos da Nena, com as portas e os valores do simulador acima (taxa antes do
    valor da sacola). A linha vertical em cada barra é o limite de {sim.knobs.maxKm} km.
  </figcaption>
</figure>

<style>
  figure.w {
    display: grid;
    gap: 14px;
    margin: 12px 0;
    padding: 14px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    padding: 4px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }
  .switch button {
    min-height: 44px;
    padding: 6px 10px;
    border: 0;
    border-radius: calc(var(--radius-md) - 4px);
    background: transparent;
    color: var(--ink-muted);
    font: 600 0.875rem/1.3 var(--font-sans);
    cursor: pointer;
  }
  .switch button[aria-pressed='true'] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-e1);
  }
  .switch button:focus-visible {
    outline: 3px solid var(--ink);
    outline-offset: 1px;
  }
  figure.w ul.rows {
    display: grid;
    gap: 18px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure.w ul.rows > li {
    display: grid;
    gap: 6px;
    font-size: 0.9375rem;
    line-height: 1.4;
  }
  figure.w p {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }
  .who strong {
    font-family: var(--font-display);
  }
  .bars {
    position: relative;
    display: grid;
    gap: 3px;
    padding: 4px 0;
  }
  .bar {
    display: block;
    height: 6px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--ink) 18%, transparent);
  }
  .bar.estimate {
    background: repeating-linear-gradient(
      90deg,
      color-mix(in srgb, var(--warning) 70%, transparent) 0 6px,
      transparent 6px 9px
    );
  }
  .bar.road {
    background: color-mix(in srgb, var(--ink) 45%, transparent);
  }
  .bar.used {
    height: 10px;
    border-radius: 5px;
  }
  .bar.road.used {
    background: var(--ink);
  }
  .bar.estimate.used {
    background: var(--warning);
  }
  .max {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 2px dashed var(--danger);
  }
  figure.w p.nums {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .nums .on {
    color: var(--ink);
    font-weight: 650;
  }
  .tag {
    display: inline-block;
    margin-left: 4px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--warning-soft);
    color: var(--ink);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .eta {
    display: block;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  figure.w figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
</style>
