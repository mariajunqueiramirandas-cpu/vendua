<script lang="ts">
  import { BILLS, MAX_PAYMENTS, brl, parseCents, plain } from './money';

  // "Dividir em formas" at the counter (apps/admin/src/features/pdv/PaySheet.tsx): each method
  // tapped adds a payment carrying what is still missing, the payments must add up to exactly the
  // total (Core answers PAYMENT_MISMATCH otherwise), at most 10 per sale, and cash takes what the
  // customer handed over, with the change worked out by the store.

  type Method = 'cash' | 'pix' | 'credit' | 'debit' | 'voucher';
  interface Entry {
    id: number;
    method: Method;
    amount: number;
    /** cash only: the notes handed over, 0 = the exact amount */
    tendered: number;
  }

  const LABEL: Record<Method, string> = {
    cash: 'Dinheiro',
    pix: 'Pix',
    credit: 'Crédito',
    debit: 'Débito',
    voucher: 'Vale-refeição',
  };
  const NOTE: Record<Method, string> = {
    cash: 'o troco sai calculado',
    pix: 'QR da chave da loja, com o valor',
    credit: 'na maquininha da loja',
    debit: 'na maquininha da loja',
    voucher: 'na maquininha da loja',
  };
  const METHODS = Object.keys(LABEL) as Method[];

  const ITEMS = [
    { qty: 3, name: 'Fatia de cenoura com brigadeiro', unit: 900 },
    { qty: 1, name: 'Café coado 300 ml', unit: 650 },
    { qty: 1, name: 'Suco de laranja 400 ml', unit: 1000 },
  ];
  const TOTAL = ITEMS.reduce((n, i) => n + i.qty * i.unit, 0);

  const uid = $props.id();
  let seq = 2;
  const start = (): Entry[] => [
    { id: 1, method: 'pix', amount: 2000, tendered: 0 },
    { id: 2, method: 'cash', amount: TOTAL - 2000, tendered: 5000 },
  ];
  let entries = $state<Entry[]>(start());
  let done = $state<null | { change: number; methods: string }>(null);

  const paid = $derived(entries.reduce((n, e) => n + e.amount, 0));
  const rest = $derived(TOTAL - paid);
  const short = (e: Entry) => e.method === 'cash' && e.tendered > 0 && e.tendered < e.amount;
  const change = $derived(
    entries.reduce(
      (n, e) => n + (e.method === 'cash' && e.tendered > e.amount ? e.tendered - e.amount : 0),
      0,
    ),
  );
  const empty = $derived(entries.some((e) => e.amount <= 0));
  const anyShort = $derived(entries.some(short));
  const ok = $derived(entries.length > 0 && rest === 0 && !empty && !anyShort);
  const full = $derived(entries.length >= MAX_PAYMENTS);

  const status = $derived(
    entries.length === 0
      ? 'Escolha como o cliente vai pagar.'
      : empty
        ? 'Cada forma precisa de um valor.'
        : rest > 0
          ? `Falta ${brl(rest)} para fechar a venda.`
          : rest < 0
            ? `Passou ${brl(-rest)} do total. As formas precisam somar exatamente ${brl(TOTAL)}.`
            : anyShort
              ? 'O dinheiro recebido é menos que o valor a pagar.'
              : `As formas somam ${brl(TOTAL)}. Pronto para cobrar.`,
  );

  function pick(m: Method) {
    if (full) return;
    entries.push({ id: ++seq, method: m, amount: Math.max(0, rest), tendered: 0 });
  }
  function commit(id: number, el: HTMLInputElement) {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    const v = parseCents(el.value);
    if (v !== null && v <= TOTAL * 10) {
      e.amount = v;
      if (e.tendered && e.tendered < v) e.tendered = 0;
    }
    el.value = plain(e.amount);
  }
  const bills = (amount: number) => BILLS.filter((b) => b > amount).slice(0, 3);

  // the bar: each payment's share of the total, the missing part hatched
  const scale = $derived(Math.max(TOTAL, paid));
</script>

<figure class="cobrar" aria-label="Exemplo de cobrança dividida em formas de pagamento">
  <div class="till">
    <div class="ticket">
      <ul class="items" aria-label="itens da venda">
        {#each ITEMS as i (i.name)}
          <li>
            <span class="qty tnum">{i.qty}×</span>
            <span class="name">{i.name}</span>
            <span class="tnum">{brl(i.qty * i.unit)}</span>
          </li>
        {/each}
      </ul>
      <p class="total">
        <span>Para levar</span>
        <strong class="tnum">{brl(TOTAL)}</strong>
      </p>
    </div>

    {#if done}
      <div class="done" role="status">
        <p class="done-title">Venda feita</p>
        <p class="done-body">
          {done.methods}. Virou um pedido como os do cardápio online: já está em Pedidos, na cozinha
          e no caixa.
        </p>
        {#if done.change}
          <p class="display">
            <span>Troco</span>
            <strong class="tnum">{brl(done.change)}</strong>
          </p>
        {/if}
        <button
          type="button"
          class="ghost"
          onclick={() => {
            entries = start();
            done = null;
          }}>nova venda</button
        >
      </div>
    {:else}
      <div class="pay">
        <p class="ask">Como vai pagar?</p>
        <div class="chips" role="group" aria-label="formas de pagamento">
          {#each METHODS as m (m)}
            <button type="button" class="chip" disabled={full} onclick={() => pick(m)}>
              {LABEL[m]}
            </button>
          {/each}
        </div>
        <p class="hint">
          {full
            ? `No máximo ${MAX_PAYMENTS} formas por venda.`
            : 'Toque nas formas na ordem em que o cliente paga e ajuste cada valor.'}
        </p>

        <div class="bar" aria-hidden="true">
          {#each entries as e (e.id)}
            <span class="seg m-{e.method}" style="width: {(Math.max(0, e.amount) / scale) * 100}%"
            ></span>
          {/each}
          {#if rest > 0}
            <span class="seg missing" style="width: {(rest / scale) * 100}%"></span>
          {/if}
        </div>

        <ul class="entries" aria-label="pagamentos">
          {#each entries as e (e.id)}
            <li class="entry">
              <div class="row">
                <span class="swatch m-{e.method}" aria-hidden="true"></span>
                <label class="m" for="{uid}-{e.id}">{LABEL[e.method]}</label>
                <span class="field">
                  <span aria-hidden="true">R$</span>
                  <input
                    id="{uid}-{e.id}"
                    class="tnum"
                    inputmode="decimal"
                    autocomplete="off"
                    value={plain(e.amount)}
                    onchange={(ev) => commit(e.id, ev.currentTarget)}
                    onkeydown={(ev) => ev.key === 'Enter' && commit(e.id, ev.currentTarget)}
                  />
                </span>
                <button
                  type="button"
                  class="remove"
                  aria-label="tirar {LABEL[e.method]}"
                  onclick={() => (entries = entries.filter((x) => x.id !== e.id))}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg
                  >
                </button>
              </div>
              <p class="note">{NOTE[e.method]}</p>
              {#if e.method === 'cash'}
                <div class="cash" role="group" aria-label="dinheiro recebido">
                  <span class="cash-label">Recebido</span>
                  <button
                    type="button"
                    class="bill"
                    aria-pressed={e.tendered === 0}
                    onclick={() => (e.tendered = 0)}>exato</button
                  >
                  {#each bills(e.amount) as b (b)}
                    <button
                      type="button"
                      class="bill tnum"
                      aria-pressed={e.tendered === b}
                      onclick={() => (e.tendered = b)}>{brl(b)}</button
                    >
                  {/each}
                </div>
                {#if short(e)}
                  <p class="warn">Menos que o valor a pagar.</p>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>

        <p class="status" class:good={ok} aria-live="polite">{status}</p>

        <div class="foot">
          <p class="display">
            <span>Troco</span>
            <strong class="tnum">{brl(change)}</strong>
          </p>
          <button
            type="button"
            class="go"
            disabled={!ok}
            onclick={() =>
              (done = {
                change,
                methods: entries.map((e) => `${LABEL[e.method]} ${brl(e.amount)}`).join(', '),
              })}
          >
            cobrar {brl(TOTAL)}
          </button>
        </div>
      </div>
    {/if}
  </div>
  <figcaption>
    Simulação com a Bolos da Nena, nas regras do PDV: as formas somam exatamente o total, são até
    {MAX_PAYMENTS} por venda, e as notas oferecidas no dinheiro são as que passam do valor.
  </figcaption>
</figure>

<style>
  figure.cobrar {
    margin: 12px 0;
    display: grid;
    gap: 12px;
  }
  .till {
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-e2);
    overflow: hidden;
  }
  figure.cobrar p,
  figure.cobrar li {
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }
  figure.cobrar ul {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* the sale, like the slip the counter prints */
  .ticket {
    padding: 18px 20px 16px;
    background: var(--surface-sunken);
    border-bottom: 2px dashed var(--line-strong);
  }
  .items li {
    display: grid;
    grid-template-columns: 2.2em 1fr auto;
    gap: 8px;
    padding-block: 3px;
  }
  figure.cobrar .items li {
    color: var(--ink-muted);
  }
  .qty {
    color: var(--ink);
    font-weight: 600;
  }
  .total {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  figure.cobrar .total span {
    color: var(--ink-muted);
  }
  figure.cobrar .total strong {
    font: 600 1.5rem/1.2 var(--font-display);
    letter-spacing: -0.02em;
  }

  .pay,
  .done {
    padding: 18px 20px 20px;
    display: grid;
    gap: 12px;
  }
  figure.cobrar .ask {
    font-weight: 650;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip,
  .bill,
  .ghost {
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.9375rem/1 var(--font-sans);
    cursor: pointer;
  }
  .chip:hover:not(:disabled),
  .bill:hover,
  .ghost:hover {
    background: var(--hover);
  }
  .chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  figure.cobrar .hint {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }

  .bar {
    display: flex;
    height: 14px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-sunken);
    gap: 2px;
  }
  .seg {
    height: 100%;
    transition: width var(--duration-smooth) var(--ease-soft);
  }
  .missing {
    background: repeating-linear-gradient(-45deg, var(--line-strong) 0 4px, transparent 4px 8px);
  }
  .m-cash {
    background: var(--success);
  }
  .m-pix {
    background: var(--info);
  }
  .m-credit {
    background: var(--warning);
  }
  .m-debit {
    background: var(--ink);
  }
  .m-voucher {
    background: var(--ink-muted);
  }

  .entries {
    border-top: 1px solid var(--line);
  }
  figure.cobrar .entry {
    display: grid;
    gap: 8px;
    padding-block: 10px;
    border-bottom: 1px solid var(--line);
  }
  .row {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto 44px;
    align-items: center;
    gap: 10px;
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .m {
    display: grid;
    font-weight: 650;
    line-height: 1.3;
  }
  figure.cobrar .note {
    margin-top: -4px;
    padding-left: 20px;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink-muted);
    font-weight: 600;
  }
  .field:focus-within {
    outline: 2px solid var(--spark);
    outline-offset: 2px;
    box-shadow: 0 0 0 6px #123c32;
  }
  .field input {
    width: 5.2em;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: 600 1rem/1 var(--font-sans);
    text-align: right;
    outline: none;
  }
  .field input:focus-visible {
    outline: none;
    box-shadow: none;
  }
  .remove {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-muted);
    cursor: pointer;
  }
  .remove:hover {
    background: var(--hover);
    color: var(--ink);
  }
  .remove svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .cash {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-left: 20px;
  }
  .cash-label {
    margin-right: 4px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .bill {
    padding: 0 12px;
    font-size: 0.875rem;
  }
  .bill[aria-pressed='true'] {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--on-primary);
  }
  figure.cobrar .warn {
    padding-left: 20px;
    font-size: 0.8125rem;
    font-weight: 650;
    color: var(--danger);
  }
  figure.cobrar .status {
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--warning-soft);
    font-weight: 600;
  }
  figure.cobrar .status.good {
    background: var(--success-soft);
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 10px;
  }
  /* the customer's side of the register */
  figure.cobrar .display {
    flex: 1 1 10rem;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    border-radius: var(--radius-sm);
    background: var(--ink);
    color: var(--surface);
  }
  figure.cobrar .display span {
    color: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    opacity: 0.85;
  }
  figure.cobrar .display strong {
    color: inherit;
    font: 600 1.625rem/1.1 var(--font-display);
    letter-spacing: -0.02em;
  }
  .go {
    flex: 1 1 10rem;
    min-height: 52px;
    padding: 0 18px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--spark);
    color: var(--on-spark);
    font: 700 1rem/1 var(--font-sans);
    cursor: pointer;
  }
  .go:disabled {
    background: var(--surface-sunken);
    color: var(--ink-muted);
    cursor: not-allowed;
  }
  figure.cobrar .done-title {
    font: 600 1.25rem/1.3 var(--font-display);
  }
  figure.cobrar .done-body {
    color: var(--ink-muted);
  }
  .ghost {
    justify-self: start;
  }
  figure.cobrar figcaption {
    max-width: none;
    text-align: left;
  }

  @media (prefers-color-scheme: dark) {
    .go:not(:disabled) {
      box-shadow: inset 0 -2px 0 rgb(0 0 0 / 0.2);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .seg {
      transition: none;
    }
  }
</style>
