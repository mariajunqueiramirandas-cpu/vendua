<script lang="ts">
  import Section from '$lib/components/Section.svelte';
  import Start from '$lib/components/Start.svelte';
  import { plans } from '$lib/content';
  import Calculator from '$lib/plans/Calculator.svelte';
  import Cards from '$lib/plans/Cards.svelte';
  import Compare from '$lib/plans/Compare.svelte';

  const { bandeira } = plans;
</script>

<Section id="preco" sky="linear-gradient(var(--sky-3), var(--sky-4))" labelledby="preco-t">
  <div class="top">
    <header class="head">
      <h2 id="preco-t" class="t-display">Um preço por mês.</h2>
      <p class="t-lede">
        Nenhuma taxa da Venduá por pedido. Pix todo mês ou cartão, pelo Mercado Pago.
      </p>
    </header>

    <div class="trial">
      <p class="trial-t">Comece pelo {bandeira.name}: {bandeira.trial}, sem cartão.</p>
      <Start plano={bandeira.id} label="Criar loja no {bandeira.short}" />
    </div>
  </div>

  <Cards />

  <div class="more">
    <Compare />
    <Calculator />
  </div>
</Section>

<style>
  .top {
    display: grid;
    gap: 28px 56px;
    align-items: end;
    margin-bottom: clamp(52px, 7vw, 80px);
  }
  @media (min-width: 1024px) {
    .top {
      grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    }
  }
  .head {
    display: grid;
    gap: 16px;
  }
  .trial {
    display: grid;
    justify-items: start;
    gap: 14px;
    padding: 20px 20px 22px;
    border-radius: var(--radius-lg);
    background: var(--spark);
    color: var(--on-spark);
    rotate: -0.6deg;
  }
  .trial-t {
    font: 600 1.375rem/1.25 var(--font-display);
    letter-spacing: -0.015em;
    max-width: 26ch;
    text-wrap: balance;
  }
  .trial :global(.start) {
    margin: 0;
  }
  @media (max-width: 559px) {
    .top {
      gap: 16px;
      margin-bottom: 36px;
    }
    .head {
      gap: 10px;
    }
    .trial {
      gap: 10px;
      padding: 14px 16px 16px;
    }
    .trial-t {
      font-size: 1.1875rem;
    }
  }
  @media (min-width: 1024px) {
    .trial {
      padding: 26px 30px 28px;
    }
  }
  @media (prefers-color-scheme: dark) {
    .trial {
      background: var(--spark-soft);
      color: var(--ink);
      box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--spark) 40%, transparent);
    }
  }

  .more {
    display: grid;
    gap: 16px;
    margin-top: clamp(24px, 5vw, 56px);
  }
</style>
