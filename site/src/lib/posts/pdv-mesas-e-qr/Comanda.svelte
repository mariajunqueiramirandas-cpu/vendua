<script lang="ts">
  import { bill, owed, roundTotal, SERVICE_BPS, type Tab } from './floor';
  import { MAX_WAYS, MIN_WAYS, brl, splitShares } from './money';

  // One comanda, worded as apps/admin/src/features/pdv/Comanda.tsx.
  let {
    n,
    tab,
    ways,
    onWays,
    onReceive,
    onAccept,
    onService,
    onAdd,
  }: {
    n: number;
    tab: Tab;
    ways: number;
    onWays: (w: number) => void;
    onReceive: (cents: number) => void;
    onAccept: (round: number) => void;
    onService: (on: boolean) => void;
    onAdd: () => void;
  } = $props();

  const uid = $props.id();
  const b = $derived(bill(tab));
  const online = $derived(tab.rounds.filter((r) => r.paidOnline).length);
  const waiting = $derived(tab.rounds.filter((r) => r.waiting));
  const live = $derived(tab.rounds.length);
  const shares = $derived(ways ? splitShares(Math.max(0, b.remaining), ways) : []);
</script>

<div class="comanda">
  <div class="head">
    <p class="title">Mesa {n}</p>
    <p class="sub">
      {live}
      {live === 1 ? 'rodada' : 'rodadas'}{tab.customer ? `, ${tab.customer}` : ''}
    </p>
  </div>

  {#if live === 0}
    <div class="empty">
      <p>Comanda aberta. Cada vez que você adiciona itens, sai uma rodada para a cozinha.</p>
      <button type="button" class="btn" onclick={onAdd}>adicionar itens</button>
    </div>
  {:else}
    <ol class="rounds" aria-label="rodadas">
      {#each tab.rounds as r (r.number)}
        <li class="round" class:out={!owed(r)}>
          <div class="r-head">
            <span class="r-num tnum">#{r.number}</span>
            {#if r.source === 'qr'}<span class="tag">pelo QR</span>{/if}
            {#if r.waiting}<span class="tag warn">aguardando aceite</span>{/if}
            {#if r.paidOnline}<span class="tag good">pago online</span>{/if}
            <span class="r-total tnum">{brl(roundTotal(r))}</span>
          </div>
          <ul class="r-items">
            {#each r.items as i (i.name)}
              <li><span class="tnum">{i.qty}×</span> {i.name}</li>
            {/each}
          </ul>
          {#if r.waiting}
            <button type="button" class="btn small" onclick={() => onAccept(r.number)}>
              aceitar
            </button>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  <div class="bill">
    <dl>
      <div>
        <dt>Consumo</dt>
        <dd class="tnum">{brl(b.consumo)}</dd>
      </div>
      <div>
        <dt>Serviço ({SERVICE_BPS / 100}%){tab.serviceFee ? '' : ', recusado'}</dt>
        <dd class="tnum">+{brl(b.service)}</dd>
      </div>
      <div class="strong">
        <dt>Total</dt>
        <dd class="tnum">{brl(b.total)}</dd>
      </div>
      {#if b.paid}
        <div class="paid">
          <dt>Pago</dt>
          <dd class="tnum">−{brl(b.paid)}</dd>
        </div>
      {/if}
    </dl>
    {#if online}
      <p class="aside">
        {online === 1
          ? 'A rodada paga online fica fora dessa conta.'
          : `As ${online} rodadas pagas online ficam fora dessa conta.`}
      </p>
    {/if}
    {#if waiting.length}
      <p class="notice">
        {waiting.length === 1
          ? 'Um pedido pelo QR aguarda aceite. Ele fica fora da conta até alguém aceitar, e a comanda só fecha depois disso.'
          : `${waiting.length} pedidos pelo QR aguardam aceite. Eles ficam fora da conta até alguém aceitar.`}
      </p>
    {/if}

    <div class="due" aria-live="polite">
      <span>Falta receber</span>
      <strong class="tnum">{brl(Math.max(0, b.remaining))}</strong>
    </div>

    <label class="switch">
      <input
        type="checkbox"
        checked={tab.serviceFee}
        onchange={(e) => onService(e.currentTarget.checked)}
      />
      <span class="track" aria-hidden="true"></span>
      <span class="sw-text">
        <strong>Taxa de serviço</strong>
        <span>Desligue se o cliente não quiser pagar.</span>
      </span>
    </label>

    {#if b.remaining > 0}
      <div class="actions">
        {#if b.remaining > 1}
          <button
            type="button"
            class="btn"
            class:ghost={!ways}
            aria-pressed={!!ways}
            onclick={() => onWays(ways ? 0 : MIN_WAYS)}
          >
            dividir a conta
          </button>
        {/if}
        {#if !ways}
          <button type="button" class="btn" onclick={() => onReceive(b.remaining)}>
            receber {brl(b.remaining)}
          </button>
        {/if}
      </div>
    {/if}

    {#if ways && b.remaining > 0}
      <div class="split">
        <div class="split-head">
          <span id="{uid}-ways">Dividir por</span>
          <div class="stepper" role="group" aria-labelledby="{uid}-ways">
            <button
              type="button"
              aria-label="uma parte a menos"
              disabled={ways <= MIN_WAYS}
              onclick={() => onWays(ways - 1)}>−</button
            >
            <output class="tnum" aria-live="polite">{ways} partes</output>
            <button
              type="button"
              aria-label="uma parte a mais"
              disabled={ways >= MAX_WAYS}
              onclick={() => onWays(ways + 1)}>+</button
            >
          </div>
        </div>
        <ul class="parts" aria-label="partes da conta">
          {#each shares as c, i (i)}
            <li>
              <button
                type="button"
                class="part"
                aria-label="receber a parte {i + 1}, {brl(c)}"
                onclick={() => onReceive(c)}
              >
                <span>parte {i + 1}</span>
                <strong class="tnum">{brl(c)}</strong>
              </button>
            </li>
          {/each}
        </ul>
        <p class="aside">Toque numa parte para receber esse valor.</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .comanda {
    display: grid;
    gap: 14px;
    padding: 18px 18px 20px;
  }
  .comanda p,
  .comanda li,
  .comanda dt,
  .comanda dd {
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }
  .comanda ul,
  .comanda ol {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .comanda .title {
    font: 600 1.375rem/1.2 var(--font-display);
    letter-spacing: -0.015em;
  }
  .comanda .sub {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .empty {
    display: grid;
    gap: 10px;
    justify-items: start;
  }
  .comanda .empty p {
    color: var(--ink-muted);
  }

  .comanda .rounds {
    gap: 8px;
  }
  .comanda .round {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }
  .comanda .round.out {
    background: transparent;
    border: 1.5px dashed var(--line-strong);
  }
  .r-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .r-num {
    font-weight: 700;
  }
  .r-total {
    margin-left: auto;
    font-weight: 650;
  }
  .out .r-total {
    color: var(--ink-muted);
  }
  .tag {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--info-soft);
    color: var(--info);
    font-size: 0.75rem;
    font-weight: 650;
    line-height: 1.5;
  }
  .tag.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .tag.good {
    background: var(--success-soft);
    color: var(--success);
  }
  .comanda .r-items li {
    font-size: 0.875rem;
    color: var(--ink-muted);
  }

  .bill {
    display: grid;
    gap: 10px;
  }
  dl {
    display: grid;
    gap: 4px;
    margin: 0;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .comanda dt,
  .comanda dd {
    margin: 0;
    color: var(--ink-muted);
  }
  .comanda .strong dt,
  .comanda .strong dd {
    color: var(--ink);
    font-weight: 650;
  }
  .comanda .paid dt,
  .comanda .paid dd {
    color: var(--success);
    font-weight: 600;
  }
  .comanda .aside {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .comanda .notice {
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--warning-soft);
    font-size: 0.875rem;
    font-weight: 500;
  }
  .due {
    display: grid;
    gap: 2px;
    padding: 12px 16px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }
  .due span {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--ink-muted);
  }
  .due strong {
    font: 600 2rem/1.1 var(--font-display);
    letter-spacing: -0.03em;
    color: var(--ink);
  }

  .switch {
    position: relative;
    display: grid;
    grid-template-columns: 48px 1fr;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    cursor: pointer;
  }
  .switch input {
    position: absolute;
    opacity: 0;
    width: 48px;
    height: 28px;
    margin: 0;
  }
  .track {
    position: relative;
    width: 48px;
    height: 28px;
    border-radius: 999px;
    background: var(--line-strong);
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .track::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow-e1);
    transition: translate var(--duration-quick) var(--ease-soft);
  }
  .switch input:checked + .track {
    background: var(--primary);
  }
  .switch input:checked + .track::after {
    translate: 20px 0;
  }
  .switch input:focus-visible + .track {
    outline: 2px solid var(--spark);
    outline-offset: 2px;
    box-shadow: 0 0 0 6px #123c32;
  }
  .sw-text {
    display: grid;
    line-height: 1.35;
  }
  .sw-text strong {
    font-size: 0.9375rem;
    font-weight: 650;
    color: var(--ink);
  }
  .sw-text span {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .btn {
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--primary);
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font: 600 0.9375rem/1 var(--font-sans);
    cursor: pointer;
  }
  .btn.ghost {
    border-color: var(--line-strong);
    background: var(--surface);
    color: var(--ink);
  }
  .btn.ghost:hover {
    background: var(--hover);
  }
  .btn.small {
    justify-self: start;
    min-height: 44px;
    padding: 0 14px;
    font-size: 0.875rem;
  }

  .split {
    display: grid;
    gap: 10px;
    padding: 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }
  .split-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.875rem;
    font-weight: 650;
    color: var(--ink);
  }
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .stepper button {
    width: 44px;
    height: 44px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 1.25rem/1 var(--font-sans);
    cursor: pointer;
  }
  .stepper button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .stepper output {
    min-width: 5.5em;
    text-align: center;
    font-weight: 650;
  }
  .comanda .parts {
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
    gap: 8px;
  }
  .part {
    display: grid;
    width: 100%;
    min-height: 56px;
    padding: 8px 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-e1);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .part:hover {
    background: var(--hover);
  }
  .part span {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .part strong {
    font-size: 1rem;
    font-weight: 650;
  }

  @media (prefers-reduced-motion: reduce) {
    .track,
    .track::after {
      transition: none;
    }
  }
</style>
