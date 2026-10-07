<script lang="ts">
  import Knobs from './Knobs.svelte';
  import MapCanvas from './MapCanvas.svelte';
  import Receipt from './Receipt.svelte';
  import { CARTS, DOORS, brl, quote, roadKm } from './model';
  import { sim } from './state.svelte';

  const door = $derived(DOORS.find((d) => d.id === sim.doorId) ?? null);
  const cart = $derived(CARTS.find((c) => c.id === sim.cartId) ?? CARTS[1]!);
  const q = $derived(quote(sim.knobs, roadKm(sim.door), cart.cents));
  const who = $derived(door ? `${door.name}, ${door.where}` : 'Porta escolhida no mapa');
</script>

<figure class="w" aria-label="Simulador da taxa de entrega por distância">
  <div class="presets" role="group" aria-label="Portas de exemplo">
    {#each DOORS as d (d.id)}
      <button
        type="button"
        aria-pressed={sim.doorId === d.id}
        onclick={() => {
          sim.door = { ...d.at };
          sim.doorId = d.id;
        }}
      >
        <strong>{d.name}</strong>
        <span>{d.where}</span>
      </button>
    {/each}
  </div>

  <MapCanvas label="Porta do cliente" doorName={door?.name ?? 'Porta'} />

  <p class="legend">
    <span class="key reach" aria-hidden="true"></span>
    Até onde o caminho de carro chega dentro do limite.
    <span class="key ring" aria-hidden="true"></span>
    Círculos: a distância em linha reta.
  </p>

  <div class="cart" role="group" aria-label="Sacola de exemplo">
    {#each CARTS as c (c.id)}
      <button type="button" aria-pressed={sim.cartId === c.id} onclick={() => (sim.cartId = c.id)}>
        <span>{c.label}</span>
        <strong class="tnum">{brl(c.cents)}</strong>
      </button>
    {/each}
  </div>

  <Receipt {q} knobs={sim.knobs} {who} cartCents={cart.cents} />

  <Knobs />

  <figcaption>
    Simulação com a Bolos da Nena: o bairro, as ruas e os valores são de exemplo; a conta é a mesma
    regra que a Venduá usa na loja. Arraste o pino da porta, toque no mapa ou escolha uma das
    portas.
  </figcaption>
</figure>

<style>
  figure.w {
    display: grid;
    gap: 14px;
    margin: 12px 0;
    padding: 14px;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--surface-sunken) 55%, var(--surface));
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .presets button,
  .cart button {
    min-height: 44px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    cursor: pointer;
    font: 500 0.875rem/1.3 var(--font-sans);
    text-align: left;
  }
  .presets button {
    display: grid;
    padding: 8px 10px;
  }
  .presets button strong {
    font: 600 1rem/1.3 var(--font-display);
    color: inherit;
  }
  .presets span {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .presets button[aria-pressed='true'],
  .cart button[aria-pressed='true'] {
    background: var(--ink);
    color: var(--surface);
    box-shadow: none;
  }
  .presets button[aria-pressed='true'] span {
    color: color-mix(in srgb, var(--surface) 80%, transparent);
  }
  .presets button:focus-visible,
  .cart button:focus-visible {
    outline: 3px solid var(--ink);
    outline-offset: 2px;
  }
  figure.w p.legend {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  .key {
    display: inline-block;
    width: 14px;
    height: 10px;
    margin: 0 4px 0 2px;
    border-radius: 3px;
    vertical-align: -1px;
  }
  .key.reach {
    background: color-mix(in srgb, var(--spark) 55%, transparent);
    outline: 1.5px dashed color-mix(in srgb, var(--ink) 45%, transparent);
  }
  .key.ring {
    margin-left: 10px;
    border-radius: 50%;
    width: 10px;
    border: 1.5px dashed color-mix(in srgb, var(--ink) 45%, transparent);
  }
  .cart {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  .cart button {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    padding: 8px 12px;
  }
  .cart button strong {
    flex: none;
    font: 600 0.9375rem/1.3 var(--font-display);
    color: inherit;
  }
  @media (min-width: 560px) {
    .cart button {
      display: grid;
      align-content: space-between;
    }
  }
  @media (min-width: 560px) {
    figure.w {
      padding: 18px;
    }
    .cart {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  figure.w figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  @media (prefers-color-scheme: dark) {
    .key.reach {
      background: color-mix(in srgb, var(--spark) 22%, transparent);
    }
  }
</style>
