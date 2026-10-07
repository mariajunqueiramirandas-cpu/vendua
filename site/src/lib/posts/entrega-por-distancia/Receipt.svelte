<script lang="ts">
  import { brl, km1, type Knobs, type Quote } from './model';

  // The fee worked out line by line, the way Core does it: base + started km × per km, the minimum,
  // then the cart against the threshold. Past the maximum, the customer's own words from the
  // storefront's map (packages/ui-defaults/src/location.tsx).
  let { q, knobs, who, cartCents }: { q: Quote; knobs: Knobs; who: string; cartCents: number } =
    $props();
</script>

<div class="receipt" aria-live="polite">
  {#if q.ok}
    <p class="head">
      <span>{who}</span>
      <strong class="tnum">{km1(q.km)} km pelo caminho</strong>
    </p>
    <dl>
      <div>
        <dt>Taxa de saída</dt>
        <dd class="tnum">{brl(knobs.baseFeeCents)}</dd>
      </div>
      <div>
        <dt>
          {q.started}
          {q.started === 1 ? 'km começado' : 'km começados'} × {brl(knobs.feePerKmCents)}
        </dt>
        <dd class="tnum">{brl(q.started * knobs.feePerKmCents)}</dd>
      </div>
      {#if knobs.minFeeCents}
        <div class:hit={q.byMinimum}>
          <dt>
            Taxa mínima de {brl(knobs.minFeeCents)}
            <span class="why"
              >{q.byMinimum ? 'a conta ficou abaixo, vale a mínima' : 'a conta já passou'}</span
            >
          </dt>
          <dd class="tnum">{q.byMinimum ? brl(knobs.minFeeCents) : 'ok'}</dd>
        </div>
      {/if}
      <div class:hit={q.byThreshold}>
        <dt>
          Sacola de {brl(cartCents)}
          <span class="why">
            {#if knobs.freeOverCents == null}
              a loja não definiu um valor para pagar a entrega
            {:else if q.byThreshold}
              a partir de {brl(knobs.freeOverCents)}, a loja paga a entrega
            {:else}
              faltam {brl(knobs.freeOverCents - cartCents)} para a loja pagar a entrega
            {/if}
          </span>
        </dt>
        <dd class="tnum">{q.byThreshold ? `− ${brl(q.fee)}` : '—'}</dd>
      </div>
    </dl>
    <p class="total">
      <span>Entrega</span>
      <strong class="tnum">{brl(q.charged)}</strong>
    </p>
  {:else}
    <p class="head">
      <span>{who}</span>
      <strong class="tnum">{km1(q.km)} km pelo caminho</strong>
    </p>
    <p class="refused">
      <span class="mark" aria-hidden="true">!</span>
      <span>
        Passa dos {knobs.maxKm} km que a loja definiu. No mapa, o cliente lê:
        <q>Esse local fica fora da área de entrega.</q>
      </span>
    </p>
    <p class="total out">
      <span>Entrega</span>
      <strong>não sai</strong>
    </p>
  {/if}
</div>

<style>
  .receipt {
    display: grid;
    gap: 10px;
    padding: 16px 18px;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-e1);
  }
  .receipt p.head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 2px 12px;
    margin: 0;
    font: 500 0.9375rem/1.4 var(--font-sans);
    color: var(--ink-muted);
  }
  .receipt p.head strong {
    font-family: var(--font-display);
    color: var(--ink);
  }
  dl {
    display: grid;
    margin: 0;
    border-top: 1px dashed var(--line-strong);
  }
  dl > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px dashed var(--line-strong);
  }
  dt {
    font: 500 0.9375rem/1.4 var(--font-sans);
    color: var(--ink);
  }
  .why {
    display: block;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  dd {
    margin: 0;
    font: 600 0.9375rem/1.4 var(--font-sans);
    color: var(--ink);
    text-align: right;
  }
  .hit dt,
  .hit dd {
    font-weight: 650;
  }
  .hit .why {
    color: var(--success);
  }
  .receipt p.total {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 0;
    font: 600 1rem/1.3 var(--font-sans);
    color: var(--ink);
  }
  .total strong {
    font: 600 1.75rem/1.1 var(--font-display);
    letter-spacing: -0.02em;
  }
  .total.out strong {
    color: var(--danger);
  }
  .receipt p.refused {
    display: flex;
    gap: 10px;
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--warning-soft);
    font: 500 0.9375rem/1.5 var(--font-sans);
    color: var(--ink);
  }
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--warning);
    color: var(--surface);
    font: 700 0.8125rem/1 var(--font-display);
  }
</style>
