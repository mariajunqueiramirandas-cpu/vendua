<script lang="ts">
  import Comanda from './Comanda.svelte';
  import { bill, firstRound, floor, type Table } from './floor';
  import { MAX_WAYS, MIN_WAYS, brl } from './money';

  // Mesas as a floor plan (apps/admin/src/features/pdv/Mesas.tsx, ui/pdv/TableTile.tsx): a free
  // table is dashed and opens a comanda with one tap, a taken one shows its total. The comanda
  // beside it is Comanda.tsx's: rounds, consumo, serviço, pago, falta receber, dividir a conta.

  let tables = $state<Table[]>(floor());
  let selected = $state(5);
  let ways = $state(3);
  let next = 39;
  let closed = $state<number | null>(null);

  const table = $derived(tables.find((t) => t.n === selected)!);

  function label(t: Table) {
    if (!t.tab) return `Mesa ${t.n}, livre: abrir comanda`;
    const waiting = t.tab.rounds.filter((r) => r.waiting).length;
    return `Mesa ${t.n}, ocupada, ${brl(bill(t.tab).total)}${
      waiting
        ? `, ${waiting === 1 ? 'um pedido' : `${waiting} pedidos`} pelo QR aguardando aceite`
        : ''
    }`;
  }

  function choose(t: Table) {
    closed = null;
    if (!t.tab) t.tab = { rounds: [], customer: null, serviceFee: true, paid: [] };
    if (selected !== t.n) ways = 0;
    selected = t.n;
  }

  function receive(cents: number) {
    const tab = table.tab;
    if (!tab || cents <= 0) return;
    tab.paid.push({ cents, method: 'Pix' });
    if (ways) ways = ways > MIN_WAYS ? ways - 1 : 0;
    const b = bill(tab);
    // a comanda closes by itself once nothing remains and no QR order waits
    if (b.remaining === 0 && !tab.rounds.some((r) => r.waiting) && tab.rounds.length) {
      table.tab = null;
      ways = 0;
      closed = table.n;
    }
  }

  function reset() {
    tables = floor();
    selected = 5;
    ways = 3;
    closed = null;
  }
</script>

<figure class="salao-w" aria-label="Exemplo do salão com as mesas e uma comanda">
  <div class="card">
    <div class="plan">
      <div class="counter" aria-hidden="true">
        <span>Balcão</span>
        <span class="vitrine">vitrine</span>
      </div>
      <ul class="tables" aria-label="mesas do salão">
        {#each tables as t (t.n)}
          {@const waiting = t.tab ? t.tab.rounds.some((r) => r.waiting) : false}
          <li class="spot">
            <button
              type="button"
              class="table {t.shape}"
              class:busy={!!t.tab}
              class:on={selected === t.n}
              aria-label={label(t)}
              aria-pressed={selected === t.n}
              onclick={() => choose(t)}
            >
              <span class="chair c-top" aria-hidden="true"></span>
              <span class="chair c-bottom" aria-hidden="true"></span>
              {#if t.shape === 'square'}
                <span class="chair c-left" aria-hidden="true"></span>
                <span class="chair c-right" aria-hidden="true"></span>
              {/if}
              <span class="n">{t.n}</span>
              <span class="what tnum">{t.tab ? brl(bill(t.tab).total) : 'livre'}</span>
              {#if waiting}
                <span class="qr" aria-hidden="true">QR</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
      <span class="door" aria-hidden="true">entrada</span>
    </div>
    <ul class="legend" aria-hidden="true">
      <li><span class="key free"></span>livre</li>
      <li><span class="key busy"></span>comanda aberta</li>
      <li><span class="key qr-key">QR</span><span>pedido pelo QR esperando a equipe</span></li>
    </ul>

    <div class="sheet">
      {#if closed === table.n && !table.tab}
        <div class="closed" role="status">
          <p class="closed-title">Comanda paga e fechada. A mesa está livre.</p>
          <p>
            As rodadas foram marcadas como pagas e entregues, e o dinheiro entrou no caixa. Toque na
            Mesa {table.n} para abrir uma comanda nova.
          </p>
          <button type="button" class="ghost" onclick={reset}>voltar ao salão do exemplo</button>
        </div>
      {:else if table.tab}
        <Comanda
          n={table.n}
          tab={table.tab}
          {ways}
          onWays={(w) => (ways = Math.min(MAX_WAYS, Math.max(0, w)))}
          onReceive={receive}
          onAccept={(num) => {
            const r = table.tab?.rounds.find((x) => x.number === num);
            if (r) r.waiting = false;
          }}
          onService={(v) => {
            if (table.tab) table.tab.serviceFee = v;
          }}
          onAdd={() => table.tab?.rounds.push(firstRound(next++))}
        />
      {/if}
    </div>
  </div>
  <figcaption>
    Simulação com a Bolos da Nena. As contas seguem as regras do PDV: serviço de 10% sobre o
    consumo, o que foi pago online fora da conta, e a divisão em centavos inteiros, com o centavo
    que sobra nas primeiras partes.
  </figcaption>
</figure>

<style>
  figure.salao-w {
    margin: 12px 0;
    display: grid;
    gap: 12px;
  }
  .card {
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-e2);
    overflow: hidden;
  }
  figure.salao-w ul {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure.salao-w p,
  figure.salao-w li {
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }

  /* the floor plan: walls, a floor grid, the counter along the back wall and the way in */
  .plan {
    --t: clamp(64px, 17vw, 84px);
    position: relative;
    margin: 14px 14px 0;
    padding: 0 10px 26px;
    border: 3px solid var(--line-strong);
    border-radius: 14px;
    background-color: var(--surface-sunken);
    background-image:
      linear-gradient(var(--line) 1px, transparent 1px),
      linear-gradient(90deg, var(--line) 1px, transparent 1px);
    background-size: 28px 28px;
  }
  .counter {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 0 -10px;
    padding: 9px 16px;
    border-bottom: 3px solid var(--line-strong);
    border-radius: 10px 10px 0 0;
    background: var(--surface);
    font: 600 0.875rem/1.2 var(--font-display);
    color: var(--ink);
  }
  .vitrine {
    padding: 2px 12px;
    border: 1.5px solid var(--line-strong);
    border-radius: 6px;
    font: 500 0.75rem/1.4 var(--font-sans);
    color: var(--ink-muted);
  }
  figure.salao-w .tables {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    row-gap: 4px;
    padding-top: 10px;
  }
  .spot {
    display: grid;
    place-items: center;
    min-height: calc(var(--t) + 38px);
  }
  .door {
    position: absolute;
    right: 24px;
    bottom: -3px;
    padding: 0 12px;
    border-bottom: 3px solid var(--surface);
    background: var(--surface-sunken);
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 22px;
    color: var(--ink-muted);
  }

  .table {
    position: relative;
    display: grid;
    place-content: center;
    gap: 1px;
    width: var(--t);
    height: var(--t);
    padding: 0;
    border: 2px dashed var(--line-strong);
    background: color-mix(in srgb, var(--surface) 55%, transparent);
    color: var(--ink);
    font: inherit;
    text-align: center;
    cursor: pointer;
    transition:
      background var(--duration-quick) var(--ease-soft),
      transform var(--duration-quick) var(--ease-soft);
  }
  .table.round {
    border-radius: 50%;
  }
  .table.square {
    border-radius: 14px;
  }
  .table:hover {
    background: var(--surface);
  }
  .table:active {
    transform: scale(0.97);
  }
  .table.busy {
    border: 2px solid var(--ink);
    background: var(--surface);
    box-shadow: var(--shadow-e1);
  }
  .table.on {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--on-primary);
  }
  .n {
    font: 600 1.375rem/1 var(--font-display);
    letter-spacing: -0.02em;
  }
  .what {
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.2;
    color: var(--ink-muted);
  }
  .on .what {
    color: inherit;
  }
  .chair {
    position: absolute;
    border-radius: 6px;
    background: var(--line-strong);
  }
  .busy .chair {
    background: var(--ink-faint);
  }
  .c-top,
  .c-bottom {
    left: 50%;
    width: 30px;
    height: 9px;
    translate: -50% 0;
  }
  .c-top {
    top: -16px;
  }
  .c-bottom {
    bottom: -16px;
  }
  .c-left,
  .c-right {
    top: 50%;
    width: 8px;
    height: 30px;
    translate: 0 -50%;
  }
  .c-left {
    left: -14px;
  }
  .c-right {
    right: -14px;
  }
  .qr,
  .qr-key {
    display: inline-grid;
    place-items: center;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--warning-soft);
    color: var(--warning);
    font: 700 0.6875rem/18px var(--font-sans);
    box-shadow: 0 0 0 2px var(--surface);
  }
  .qr {
    position: absolute;
    top: -6px;
    right: -8px;
  }

  figure.salao-w .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    padding: 12px 18px 14px;
  }
  figure.salao-w .legend li {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .key {
    width: 16px;
    height: 16px;
    border-radius: 5px;
  }
  .key.free {
    border: 2px dashed var(--line-strong);
  }
  .key.busy {
    border: 2px solid var(--ink);
    background: var(--surface);
  }
  .key.qr-key {
    width: auto;
    height: auto;
    box-shadow: none;
  }

  .sheet {
    border-top: 1px solid var(--line);
    background: var(--surface);
  }
  .closed {
    display: grid;
    gap: 10px;
    padding: 20px;
  }
  figure.salao-w .closed p {
    color: var(--ink-muted);
  }
  figure.salao-w .closed .closed-title {
    font: 600 1.125rem/1.35 var(--font-display);
    color: var(--success);
  }
  .ghost {
    justify-self: start;
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.9375rem/1 var(--font-sans);
    cursor: pointer;
  }
  .ghost:hover {
    background: var(--hover);
  }
  figure.salao-w figcaption {
    max-width: none;
    text-align: left;
  }

  @media (prefers-reduced-motion: reduce) {
    .table {
      transition: none;
    }
    .table:active {
      transform: none;
    }
  }
</style>
