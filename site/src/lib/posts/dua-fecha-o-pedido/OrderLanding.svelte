<script lang="ts">
  import { brl } from './flow';

  // Where an order from the WhatsApp lands (ADR 0031 §3): it is born in the storefront's own
  // checkout, so the board, the kitchen screen, the printers, stock and loyalty treat it like any
  // order, and the owner's accept is still the human check. The push is Core's own text
  // (packages/core/src/admin/workers.ts); the board's first column is "Novos" (orders/Orders.tsx);
  // a loyalty stamp counts on a delivered order (facts: modules/customer.ts).
  let { live }: { live: boolean } = $props();
  let from: 'whatsapp' | 'site' = $state('whatsapp');

  const total = 4800;
  const stops = [
    {
      id: 'pedidos',
      name: 'Pedidos',
      what: 'Entra em Novos e o seu celular avisa. Quem aceita é você.',
    },
    { id: 'cozinha', name: 'Tela da cozinha', what: 'Aparece na fila da cozinha, com os itens.' },
    { id: 'impressora', name: 'Impressora', what: 'A comanda sai como a de qualquer pedido.' },
    { id: 'estoque', name: 'Estoque', what: 'O bolo sai do estoque no mesmo instante.' },
    {
      id: 'fidelidade',
      name: 'Cartão fidelidade',
      what: 'O selo da Bia entra quando o pedido é entregue.',
    },
  ] as const;
</script>

{#snippet icon(id: string)}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#if id === 'pedidos'}
      <rect x="3" y="4" width="5" height="16" rx="1.5" /><rect
        x="10"
        y="4"
        width="5"
        height="11"
        rx="1.5"
      /><rect x="17" y="4" width="4" height="7" rx="1.5" />
    {:else if id === 'cozinha'}
      <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M9 20h6M12 16v4M7 8h4M7 11h7" />
    {:else if id === 'impressora'}
      <path d="M7 9V3h10v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path
        d="M7 14h10v7H7z"
      />
    {:else if id === 'estoque'}
      <path d="M3 8 12 3l9 5v9l-9 5-9-5Z" /><path d="m3 8 9 5 9-5M12 13v9" />
    {:else}
      <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8" cy="12" r="2" /><circle
        cx="13"
        cy="12"
        r="2"
      /><circle cx="18" cy="12" r="1.2" />
    {/if}
  </svg>
{/snippet}

<div class="land">
  <div class="sources" role="group" aria-label="De onde vem o pedido">
    {#each [{ id: 'site', text: 'Site da loja' }, { id: 'whatsapp', text: 'WhatsApp, com o Duá' }] as s (s.id)}
      <button
        type="button"
        class="src"
        aria-pressed={from === s.id}
        disabled={!live}
        onclick={() => (from = s.id as typeof from)}
      >
        {s.text}
      </button>
    {/each}
  </div>
  <div class="merge" aria-hidden="true"><span></span><span></span></div>

  <div class="checkout">
    <strong>O mesmo checkout da loja</strong>
    <span>confere preços, estoque, entrega e total de novo, e cria o pedido</span>
  </div>

  <ul class="stops">
    {#each stops as s (s.id)}
      <li>
        <span class="ic">{@render icon(s.id)}</span>
        <span class="txt">
          <strong>{s.name}</strong>
          <span>{s.what}</span>
          {#if s.id === 'pedidos'}
            <span
              class="push"
              aria-label="Aviso no celular: Pedido #31 chegou, Bia, {brl(total)}, retirada"
            >
              <span class="pt">Pedido #31 chegou</span>
              <span class="pb">Bia · {brl(total)} · retirada</span>
              <span class="pa" aria-hidden="true">aceitar</span>
            </span>
          {/if}
        </span>
      </li>
    {/each}
  </ul>
  <p class="same" aria-live="polite">
    {from === 'whatsapp'
      ? 'Veio pelo WhatsApp. Daqui para baixo, nada muda.'
      : 'Veio pelo site. Daqui para baixo, é igualzinho.'}
  </p>
</div>

<style>
  .land {
    display: grid;
    justify-items: center;
    padding: 20px 16px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
    color: var(--ink);
  }
  div.land p {
    margin: 0;
  }
  .sources {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }
  .src {
    min-height: 44px;
    padding: 0 16px;
    border: 1px dashed var(--line-strong);
    border-radius: 12px;
    background: transparent;
    color: var(--ink-muted);
    font: 600 0.9375rem/1.2 var(--font-sans);
    cursor: pointer;
    transition:
      background var(--duration-quick) var(--ease-soft),
      color var(--duration-quick) var(--ease-soft);
  }
  .src[aria-pressed='true'] {
    border: 1px solid transparent;
    background: var(--spark);
    color: var(--on-spark);
  }
  .src:disabled {
    cursor: default;
  }
  .src:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .merge {
    display: flex;
    gap: 0;
    width: 120px;
    height: 26px;
  }
  .merge span {
    flex: 1;
    border-bottom: 2px solid var(--line-strong);
  }
  .merge span:first-child {
    border-left: 2px solid var(--line-strong);
    border-bottom-left-radius: 12px;
  }
  .merge span:last-child {
    border-right: 2px solid var(--line-strong);
    border-bottom-right-radius: 12px;
  }
  .checkout {
    position: relative;
    display: grid;
    gap: 2px;
    margin-top: 14px;
    padding: 12px 18px;
    width: 100%;
    max-width: 32rem;
    border-radius: var(--radius-md);
    background: var(--primary);
    color: var(--on-primary);
    text-align: center;
  }
  .checkout::before {
    content: '';
    position: absolute;
    left: 50%;
    top: -16px;
    height: 16px;
    border-left: 2px solid var(--line-strong);
  }
  div.checkout strong {
    font: 600 1.0625rem/1.3 var(--font-display);
    color: inherit;
  }
  .checkout span {
    font-size: 0.875rem;
    line-height: 1.4;
    opacity: 0.85;
  }
  div.land ul.stops {
    position: relative;
    display: grid;
    gap: 10px;
    width: 100%;
    max-width: 32rem;
    margin: 0;
    padding: 22px 0 0 38px;
    list-style: none;
  }
  /* the spine down from the checkout, drawn piece by piece so it ends at the last branch */
  ul.stops li::after {
    content: '';
    position: absolute;
    left: -24px;
    top: -10px;
    bottom: 0;
    border-left: 2px solid var(--line-strong);
  }
  ul.stops li:first-child::after {
    top: -22px;
  }
  ul.stops li:last-child::after {
    bottom: auto;
    height: 37px;
  }
  ul.stops li {
    position: relative;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-e1);
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }
  ul.stops li::before {
    content: '';
    position: absolute;
    left: -24px;
    top: 26px;
    width: 24px;
    border-top: 2px solid var(--line-strong);
  }
  .ic {
    flex: none;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--spark-soft);
  }
  .ic svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .txt {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .txt > span {
    color: var(--ink-muted);
    font-size: 0.875rem;
  }
  span.txt strong {
    font-weight: 650;
    color: var(--ink);
  }
  .push {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 10px;
    align-items: center;
    margin-top: 6px;
    padding: 8px 12px;
    border-radius: 14px;
    background: var(--glass);
    box-shadow:
      inset 0 0 0 1px var(--line),
      var(--shadow-e1);
  }
  .pt {
    font-weight: 650;
    color: var(--ink);
  }
  .pb {
    grid-row: 2;
    color: var(--ink-muted);
    font-size: 0.8125rem;
  }
  .pa {
    grid-row: 1 / 3;
    grid-column: 2;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font-weight: 650;
    font-size: 0.8125rem;
  }
  .land .same {
    margin-top: 14px;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
    text-align: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .src {
      transition: none;
    }
  }
</style>
