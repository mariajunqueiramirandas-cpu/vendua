<script lang="ts">
  import { brl, feeOf, lines, ORDER_NUMBER, totalOf, type Msg, type State } from './flow';

  // The ledger beside the chat: the cart as the store computes it, every summary sent and the one a
  // yes would close. A paper strip, torn top and bottom, because it is the store's receipt.
  let { s }: { s: State } = $props();

  const sent = $derived(
    s.msgs.filter((m): m is Extract<Msg, { kind: 'summary' }> => m.kind === 'summary'),
  );
</script>

<div class="fita">
  <p class="head">Conta feita pela Venduá</p>
  <table>
    <caption class="sr-only">A sacola da Bia agora, como a loja calcula</caption>
    <tbody>
      {#each lines(s.cart) as l (l.text)}
        <tr class:lit={s.touched === 'slice' && l.text.includes('Fatia')}>
          <td>{l.text.replace('1× ', '')}</td>
          <td class="num">{brl(l.cents)}</td>
        </tr>
      {/each}
      <tr class:lit={s.touched === 'mode'}>
        {#if s.cart.mode === 'delivery'}
          <td>Entrega</td><td class="num">{brl(feeOf(s.cart))}</td>
        {:else}
          <td>Retirada na loja</td><td class="num">sem entrega</td>
        {/if}
      </tr>
    </tbody>
    <tfoot>
      <tr><th scope="row">Total</th><td class="num">{brl(totalOf(s.cart))}</td></tr>
    </tfoot>
  </table>

  <p class="sub">Resumos enviados</p>
  <ol class="sent">
    {#each sent as m (m.n)}
      {@const closed = s.placed && m.n === s.summary}
      <li class:old={m.replacedBy} class:closed>
        <span class="n">Resumo {m.n}</span>
        <span class="num">{brl(m.totalCents)}</span>
        <span class="st">
          {#if closed}virou o pedido #{ORDER_NUMBER}{:else if m.replacedBy}trocado, não vale mais{:else}esperando
            o sim{/if}
        </span>
      </li>
    {/each}
  </ol>

  <p class="gate" class:open={s.placed} aria-live="polite">
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {#if s.placed}
        <path d="m5 10.5 3.2 3.2L15 7" />
      {:else}
        <rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
      {/if}
    </svg>
    <span>
      {#if s.placed}
        Pedido feito com o sim ao resumo {s.summary}.
      {:else}
        Só vira pedido com um sim ao resumo {s.summary}.
      {/if}
    </span>
  </p>
</div>

<style>
  .fita {
    --tooth: 7px;
    position: relative;
    display: grid;
    align-content: start;
    gap: 10px;
    padding: 20px 16px 22px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-e1);
    font-size: 0.875rem;
    line-height: 1.4;
    /* torn edges: little triangles cut out of the top and bottom */
    -webkit-mask:
      conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom /
        calc(2 * var(--tooth)) 51% repeat-x,
      conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top /
        calc(2 * var(--tooth)) 51% repeat-x;
    mask:
      conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom /
        calc(2 * var(--tooth)) 51% repeat-x,
      conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top /
        calc(2 * var(--tooth)) 51% repeat-x;
  }
  @media (prefers-color-scheme: dark) {
    .fita {
      background: var(--surface-raised);
    }
  }
  div.fita p {
    margin: 0;
    font-size: inherit;
    line-height: inherit;
    color: inherit;
  }
  .fita .head {
    font: 600 0.9375rem/1.3 var(--font-display);
    padding-bottom: 8px;
    border-bottom: 2px dashed var(--line-strong);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td,
  th {
    padding: 3px 4px;
    vertical-align: top;
    text-align: left;
    font-weight: inherit;
  }
  tbody tr {
    transition: background var(--duration-smooth) var(--ease-soft);
  }
  tr.lit {
    background: var(--spark-soft);
  }
  .num {
    white-space: nowrap;
    text-align: right;
    font-family: var(--font-display);
    font-variant-numeric: tabular-nums;
  }
  tfoot tr {
    border-top: 1px solid var(--line-strong);
  }
  tfoot th,
  tfoot td {
    padding-top: 6px;
    font-weight: 700;
    font-size: 1rem;
  }
  .fita .sub {
    margin-top: 4px;
    padding-top: 10px;
    border-top: 2px dashed var(--line-strong);
    font-weight: 650;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  div.fita ol.sent {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  ol.sent li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 8px;
    padding: 6px 8px;
    border-radius: 8px;
    background: var(--surface-sunken);
    font-size: 0.8125rem;
    line-height: 1.35;
    color: var(--ink);
  }
  li .n {
    font-weight: 650;
  }
  li .st {
    grid-column: 1 / -1;
    color: var(--ink-muted);
  }
  li.old .num {
    text-decoration: line-through;
    color: var(--ink-muted);
  }
  li.closed {
    background: var(--success-soft);
  }
  li.closed .st {
    color: var(--ink);
    font-weight: 600;
  }
  .fita .gate {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 9px 10px;
    border-radius: 10px;
    background: var(--warning-soft);
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.35;
  }
  .fita .gate.open {
    background: var(--success-soft);
  }
  .gate svg {
    flex: none;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: var(--warning);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .gate.open svg {
    stroke: var(--success);
    stroke-width: 2.4;
  }
  @media (prefers-reduced-motion: reduce) {
    tbody tr {
      transition: none;
    }
  }
</style>
