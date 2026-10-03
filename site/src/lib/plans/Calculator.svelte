<script lang="ts">
  import { onMount } from 'svelte';
  import { plans } from './live.svelte';
  import {
    APP_DELIVERY_BPS,
    APP_OWN_DELIVERY_BPS,
    MAX_DIGITS,
    brl,
    cents,
    commission,
    group,
  } from './money';

  // Without JavaScript (and before hydration) it shows the R$ 8.000 example, still.
  const PRESETS = [3000, 8000, 20000];
  const { bandeira } = plans;
  const plan = $derived(cents(bandeira.price));

  let live = $state(false);
  let digits = $state('8000');
  onMount(() => (live = true));

  const sales = $derived(Number(digits || 0) * 100);
  const low = $derived(commission(sales, APP_OWN_DELIVERY_BPS));
  const high = $derived(commission(sales, APP_DELIVERY_BPS));
  const scale = $derived(Math.max(high, plan));
  const pct = (c: number) => `${((c / scale) * 100).toFixed(2)}%`;

  const result = $derived(
    !sales
      ? 'Digite quanto a loja vende num mês.'
      : low >= plan
        ? `${brl(low - plan)} a ${brl(high - plan)} a mais por mês no seu bolso.`
        : high > plan
          ? `Até ${brl(high - plan)} a mais por mês no seu bolso, se o app faz a entrega. Com entrega própria, a comissão (${brl(low)}) fica abaixo do ${bandeira.short}.`
          : `Vendendo ${brl(sales)} por mês, a comissão do app fica abaixo dos ${brl(plan)} do ${bandeira.short}.`,
  );

  // keep the dots as you type, and the caret where it was among the digits
  function onInput(e: Event & { currentTarget: HTMLInputElement }) {
    const el = e.currentTarget;
    const right = el.value.slice(el.selectionStart ?? el.value.length).replace(/\D/g, '').length;
    digits = el.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITS);
    const shown = digits ? group(Number(digits)) : '';
    el.value = shown;
    let pos = shown.length;
    for (let n = 0; pos > 0 && n < right; pos--) if (/\d/.test(shown[pos - 1]!)) n++;
    el.setSelectionRange(pos, pos);
  }
</script>

<div class="calc">
  <div class="ask">
    <h3 class="t-title-1" id="calc-t">
      {#if live}<label for="vendas">Quanto você vende por mês?</label>{:else}Quanto você vende por
        mês?{/if}
    </h3>
    {#if live}
      <div class="field">
        <span class="cur" aria-hidden="true">R$</span>
        <input
          id="vendas"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          maxlength="11"
          value={digits ? group(Number(digits)) : ''}
          oninput={onInput}
          aria-describedby="calc-fonte"
        />
      </div>
      <div class="presets" role="group" aria-label="Exemplos de vendas por mês">
        {#each PRESETS as p (p)}
          <button
            type="button"
            aria-pressed={digits === String(p)}
            onclick={() => (digits = String(p))}>R$ {group(p)}</button
          >
        {/each}
      </div>
    {:else}
      <p class="static tnum">Um exemplo: R$ {group(Number(digits))} por mês.</p>
    {/if}
  </div>

  <div class="answer">
    <div class="side app">
      <p class="who">Num app de entrega, só de comissão</p>
      <p class="figs tnum">
        <span class="fig"><b>{brl(low)}</b><small>12%, entrega própria</small></span>
        <span class="to">a</span>
        <span class="fig"><b>{brl(high)}</b><small>23%, entrega do app</small></span>
      </p>
      <div class="bar" aria-hidden="true">
        <i class="seg own" style="width: {pct(low)}"></i>
        <i class="seg more" style="width: {pct(high - low)}"></i>
      </div>
    </div>

    <div class="side us">
      <p class="who">No {bandeira.name}</p>
      <p class="figs tnum">
        <span class="fig"><b>{brl(plan)}</b><small>por mês, sem comissão</small></span>
      </p>
      <div class="bar" aria-hidden="true">
        <i class="seg plan" style="width: {pct(plan)}"></i>
      </div>
    </div>

    <p class="result tnum" aria-live="polite">{result}</p>
  </div>

  <p class="fonte" id="calc-fonte">
    Comissões do iFood publicadas em blog-parceiros.ifood.com.br/taxas-ifood (atualizado em
    15/09/2026): 12% no Plano Básico e 23% no Plano Entrega, sem contar a taxa de pagamento online
    de 3,2% e a mensalidade. No Venduá, o Mercado Pago cobra a tarifa dele em cada pagamento online.
  </p>
</div>

<style>
  .calc {
    display: grid;
    gap: 22px 48px;
    padding: clamp(22px, 4vw, 40px);
    border-radius: var(--radius-xl);
    background: var(--surface);
    box-shadow: var(--shadow-e2);
  }
  @media (min-width: 900px) {
    .calc {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    }
    .fonte {
      grid-column: 1 / -1;
    }
  }
  .ask {
    display: grid;
    align-content: start;
    gap: 16px;
    min-width: 0;
  }
  h3 {
    max-width: 14ch;
  }
  @media (max-width: 559px) {
    h3 {
      max-width: none;
      font-size: 1.375rem;
      line-height: 1.75rem;
    }
  }
  label {
    cursor: pointer;
  }
  .field {
    display: flex;
    align-items: baseline;
    gap: 8px;
    max-width: 320px;
    padding: 10px 16px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
  }
  .field:focus-within {
    box-shadow: inset 0 0 0 2px var(--primary);
  }
  .cur {
    font: 600 1.375rem/1 var(--font-display);
    color: var(--ink-muted);
  }
  input {
    flex: 1;
    min-width: 0;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 600 2rem/1.2 var(--font-display);
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    outline: none;
  }
  /* the ring goes on the whole field, R$ included */
  input:focus-visible {
    outline: none;
    box-shadow: none;
  }
  .field:has(input:focus-visible) {
    outline: 2px solid var(--spark);
    outline-offset: 2px;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .presets button {
    min-height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: var(--hover);
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
    font: 600 0.9375rem/1 var(--font-sans);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .presets button:hover {
    background: var(--press);
  }
  .presets button[aria-pressed='true'] {
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: none;
  }
  .static {
    font: 600 1.25rem/1.3 var(--font-display);
  }

  .answer {
    display: grid;
    gap: 18px;
    min-width: 0;
  }
  .side {
    display: grid;
    gap: 8px;
  }
  .who {
    font-size: 0.9375rem;
    font-weight: 600;
    color: color-mix(in srgb, var(--ink) 50%, var(--ink-muted));
  }
  .figs {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 4px 14px;
  }
  .fig {
    display: grid;
  }
  .fig b {
    font: 700 1.75rem/1.1 var(--font-display);
    letter-spacing: -0.02em;
  }
  .fig small {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .to {
    padding-top: 0.45em;
    color: var(--ink-muted);
  }
  .bar {
    display: flex;
    height: 12px;
    border-radius: 999px;
    background: var(--surface-sunken);
    overflow: hidden;
  }
  .seg {
    height: 100%;
    transition: width var(--duration-smooth) var(--ease-soft);
  }
  .own {
    background: var(--warning);
  }
  .more {
    background: color-mix(in srgb, var(--warning) 40%, transparent);
  }
  .plan {
    background: var(--success);
    border-radius: 999px;
  }
  .result {
    padding-top: 16px;
    border-top: 2px dashed var(--line-strong);
    font: 600 1.25rem/1.35 var(--font-display);
    letter-spacing: -0.01em;
  }
  .fonte {
    max-width: 92ch;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .seg {
      transition: none;
    }
  }
  @media (max-width: 559px) {
    .calc {
      gap: 14px;
      padding: 16px 16px 18px;
    }
    .ask {
      gap: 12px;
    }
    .answer {
      gap: 12px;
    }
    .side {
      gap: 6px;
    }
    .fig b {
      font-size: 1.5rem;
    }
    .result {
      padding-top: 12px;
      font-size: 1.125rem;
    }
    .fonte {
      font-size: 0.75rem;
    }
    /* the plan's side is one number: label and price share a line */
    .us {
      grid-template-columns: 1fr auto;
      align-items: end;
    }
    .us .who {
      align-self: center;
    }
    .us .fig {
      justify-items: end;
      text-align: right;
    }
    .us .bar {
      grid-column: 1 / -1;
    }
    .bar {
      height: 8px;
    }
    .field {
      padding-block: 8px;
    }
    input {
      font-size: 1.75rem;
    }
  }
</style>
