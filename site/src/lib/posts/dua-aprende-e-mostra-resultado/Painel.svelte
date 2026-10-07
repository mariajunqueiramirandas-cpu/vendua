<script lang="ts">
  import Barras from './Barras.svelte';
  import Detalhes from './Detalhes.svelte';
  import { board, ENOUGH, PERIODS, type Period } from './dados';
  import { brl } from './money';

  // The Resultados screen (apps/admin/src/features/vendedor/Results.tsx), drawn with example data:
  // what Duá closed and what he helped sell, apart, then the rest of the board.
  let period = $state<Period>('7d');
  const b = $derived(board(period));
  const few = $derived(b.funnel.conversations < ENOUGH);
  const pedidos = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<figure class="painel" aria-labelledby="painel-cap">
  <div class="sheet">
    <div class="head">
      <p class="title">Resultados</p>
      <span class="tag">Exemplo</span>
    </div>
    <div class="periods" role="group" aria-label="Período">
      {#each PERIODS as p (p.value)}
        <button type="button" aria-pressed={period === p.value} onclick={() => (period = p.value)}
          >{p.label}</button
        >
      {/each}
    </div>

    {#if few}
      <p class="few" role="status">
        <strong>Ainda são poucas conversas.</strong> Com uma semana de conversas os números ficam confiáveis.
      </p>
    {/if}

    <div class="money" aria-live="polite">
      <div class="fig">
        <p class="what"><span class="sw closed" aria-hidden="true"></span>Vendido pelo Duá</p>
        <p class="big tnum">{brl(b.closed.cents)}</p>
        <p class="sub tnum">
          {pedidos(b.closed.orders, 'pedido fechado', 'pedidos fechados')} na conversa
        </p>
      </div>
      <div class="fig">
        <p class="what"><span class="sw helped" aria-hidden="true"></span>Ajudou a vender</p>
        <p class="big tnum">+ {brl(b.assisted.cents)}</p>
        <p class="sub tnum">
          {pedidos(b.assisted.orders, 'pedido feito', 'pedidos feitos')} no site até 24 h depois de ele
          mandar o link
        </p>
      </div>
    </div>

    <Barras bars={b.bars} tick={b.tick} unit={period === 'today' ? 'hora' : 'dia'} />

    <Detalhes {b} />
  </div>
  <figcaption id="painel-cap">
    Exemplo com a Bolos da Nena: números inventados para mostrar o painel, não resultados de lojas.
    As regras de conta são as do app.
  </figcaption>
</figure>

<style>
  .painel {
    margin: 16px 0;
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .sheet {
    display: grid;
    gap: 20px;
    padding: 20px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow:
      var(--shadow-e1),
      inset 0 0 0 1px var(--line);
    min-width: 0;
  }
  @media (min-width: 560px) {
    .sheet {
      padding: 24px 26px;
    }
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  figure.painel p {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }
  figure.painel p.title {
    font: 600 1.375rem/1.2 var(--font-display);
    letter-spacing: -0.015em;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    background: var(--warning-soft);
    color: var(--warning);
    font-size: 0.8125rem;
    font-weight: 650;
  }
  .periods {
    display: inline-flex;
    justify-self: start;
    padding: 4px;
    gap: 4px;
    border-radius: 999px;
    background: var(--surface-sunken);
  }
  .periods button {
    min-height: 44px;
    min-width: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-muted);
    font: 600 0.9375rem/1 var(--font-sans);
    cursor: pointer;
  }
  .periods button[aria-pressed='true'] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-e1);
  }
  .periods button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  figure.painel p.few {
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--info-soft);
    font-size: 0.875rem;
  }
  .money {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  @media (min-width: 480px) {
    .money {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .fig + .fig {
      padding-left: 18px;
      border-left: 1px solid var(--line);
    }
  }
  figure.painel p.what {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .sw {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    flex: none;
  }
  .sw.closed {
    background: var(--primary);
  }
  .sw.helped {
    background: repeating-linear-gradient(135deg, var(--info) 0 2px, var(--info-soft) 2px 5px);
    box-shadow: inset 0 0 0 1px var(--info);
  }
  figure.painel p.big {
    margin-top: 4px;
    font: 600 clamp(1.75rem, 1.4rem + 1.4vw, 2.25rem) / 1.1 var(--font-display);
    letter-spacing: -0.02em;
  }
  figure.painel p.sub {
    margin-top: 4px;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  figure.painel figcaption {
    max-width: none;
    text-align: left;
  }
</style>
