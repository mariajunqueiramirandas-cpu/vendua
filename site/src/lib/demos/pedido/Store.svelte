<script lang="ts">
  import Icon from './Icon.svelte';
  import { age, CHIP, LANES, NEXT, order, PREPS, type Prep, type State } from './script';

  // The admin's Pedidos screen on a phone (apps/admin/src/features/orders/Orders.tsx + ui/OrderCard.tsx):
  // the lane switcher and order #29's card, with the prep chips while it's new and the one big button
  // that moves it on. Sized in the phone's container units, 1 --u ≈ 1 px of a 340 px phone.
  let {
    state,
    at,
    prep,
    toast,
    onPrep,
    onNext,
  }: {
    state: State;
    /** minutes after midnight when the order reached `state` */
    at: number;
    prep: Prep;
    toast: string | null;
    onPrep?: (p: Prep) => void;
    onNext?: () => void;
  } = $props();

  const ICON = {
    placed: 'bell',
    confirmed: 'check',
    preparing: 'pot',
    ready: 'bag',
    out_for_delivery: 'moped',
    delivered: 'seal',
  } as const;
  /** the icon of the state the button moves to */
  const NEXT_ICON = {
    placed: 'check',
    confirmed: 'pot',
    preparing: 'bag',
    ready: 'moped',
    out_for_delivery: 'seal',
  } as const;

  const lane = $derived(LANES.find((l) => (l.states as readonly State[]).includes(state))!);
  const next = $derived(state === 'delivered' ? null : NEXT[state]);
</script>

<div class="app">
  <div class="top" aria-hidden="true">
    <span class="avatar">BN</span>
    <span class="open"><i></i>Aberta</span>
  </div>
  <p class="title">Pedidos</p>

  <div class="lanes" aria-hidden="true">
    {#each LANES as l (l.id)}
      {@const n = l.id === lane.id ? 1 : 0}
      <span class="lane" class:on={l.id === lane.id}>
        {l.label}
        <b class:hot={l.id === lane.id && n > 0}>{n}</b>
      </span>
    {/each}
  </div>

  <article
    class="card"
    aria-label="pedido {order.number}, {order.customer}, {order.total}, {CHIP[state]}"
  >
    <div class="head">
      <div>
        <p class="num">#{order.number}</p>
        <p class="who">{order.customer}</p>
      </div>
      <div class="side">
        <span class="chip st-{state}"><Icon name={ICON[state]} />{CHIP[state]}</span>
        <span class="age"><Icon name="timer" />{age(at)}</span>
      </div>
    </div>
    {#if state !== 'delivered'}
      <ul class="items">
        {#each order.items as i (i.name)}<li>{i.qty}× {i.name}</li>{/each}
      </ul>
    {/if}
    <p class="meta">
      <b>{order.total}</b>
      <span><Icon name="moped" />{order.neighborhood}</span>
    </p>

    {#if state === 'placed' && onPrep}
      <div class="prep" role="radiogroup" aria-label="tempo de preparo">
        <p>Fica pronto em (minutos)</p>
        <div class="preps">
          {#each PREPS as m (m)}
            <button type="button" role="radio" aria-checked={prep === m} onclick={() => onPrep(m)}>
              {m}<span class="sr-only"> minutos</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if next && onNext && state !== 'delivered'}
      <button type="button" class="go" class:first={state === 'placed'} onclick={onNext}>
        <Icon name={NEXT_ICON[state]} />
        {next}
        {#if state === 'placed'}<span class="mins">· {prep} min</span>{/if}
      </button>
    {/if}
  </article>

  {#if toast}
    {#key toast}
      <p class="toast" aria-hidden="true"><Icon name="check" />{toast}</p>
    {/key}
  {/if}
</div>

<style>
  .app {
    --u: calc(93.6cqw / 340);
    position: relative;
    height: calc(93.6cqw * 856 / 375 - 11cqw);
    overflow: hidden;
    padding: 0 calc(16 * var(--u));
    background: var(--bg);
    color: var(--ink);
    font: 500 calc(15 * var(--u)) / 1.35 var(--font-sans);
    text-align: left;
    animation: in var(--duration-smooth) var(--ease-soft);
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
  }
  p {
    margin: 0;
  }
  .top {
    display: flex;
    align-items: center;
    gap: calc(8 * var(--u));
    height: calc(56 * var(--u));
  }
  .avatar {
    display: grid;
    place-items: center;
    width: calc(40 * var(--u));
    height: calc(40 * var(--u));
    border-radius: 50%;
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: 0 0 0 calc(3 * var(--u)) var(--spark-soft);
    font: 700 calc(14 * var(--u)) / 1 var(--font-display);
  }
  .open {
    display: inline-flex;
    align-items: center;
    gap: calc(6 * var(--u));
    height: calc(36 * var(--u));
    padding: 0 calc(14 * var(--u));
    border-radius: 999px;
    background: var(--spark-soft);
    box-shadow: inset 0 0 0 1px var(--spark);
    font-weight: 600;
    font-size: calc(14 * var(--u));
  }
  .open i {
    width: calc(8 * var(--u));
    height: calc(8 * var(--u));
    border-radius: 50%;
    background: var(--success);
  }
  .title {
    margin: calc(10 * var(--u)) 0 calc(12 * var(--u));
    font: 600 calc(28 * var(--u)) / 1.2 var(--font-display);
    letter-spacing: -0.02em;
  }
  .lanes {
    display: flex;
    gap: calc(4 * var(--u));
    padding: calc(4 * var(--u));
    border-radius: calc(14 * var(--u));
    background: var(--surface-sunken);
    margin-bottom: calc(16 * var(--u));
  }
  .lane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: calc(2 * var(--u));
    padding: calc(6 * var(--u)) 0;
    border-radius: calc(11 * var(--u));
    color: var(--ink-muted);
    font-size: calc(13.5 * var(--u));
    font-weight: 600;
    transition:
      background var(--duration-quick) var(--ease-soft),
      color var(--duration-quick) var(--ease-soft);
  }
  .lane.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-e1);
  }
  .lane b {
    min-width: calc(22 * var(--u));
    padding: 0 calc(6 * var(--u));
    border-radius: 999px;
    background: var(--line);
    color: var(--ink-muted);
    font-size: calc(12 * var(--u));
    line-height: calc(22 * var(--u));
    text-align: center;
  }
  .lane b.hot {
    background: var(--spark);
    color: var(--on-spark);
  }

  .card {
    padding: calc(16 * var(--u));
    border-radius: calc(20 * var(--u));
    background: var(--surface);
    box-shadow: var(--shadow-e1);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: calc(10 * var(--u));
  }
  .num {
    font: 600 calc(38 * var(--u)) / 1 var(--font-display);
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }
  .who {
    margin-top: calc(6 * var(--u));
    font-size: calc(17 * var(--u));
    font-weight: 600;
  }
  .side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: calc(6 * var(--u));
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: calc(5 * var(--u));
    height: calc(28 * var(--u));
    padding: 0 calc(10 * var(--u));
    border-radius: 999px;
    background: var(--st);
    color: var(--st-ink);
    font-size: calc(13 * var(--u));
    font-weight: 600;
    white-space: nowrap;
  }
  /* the admin's state colours (--st-*), from the shared tokens */
  .st-placed {
    --st: var(--spark-soft);
    --st-ink: var(--ink);
  }
  .st-confirmed {
    --st: var(--info-soft);
    --st-ink: var(--info);
  }
  .st-preparing {
    --st: var(--warning-soft);
    --st-ink: var(--warning);
  }
  .st-ready,
  .st-out_for_delivery {
    --st: color-mix(in oklab, var(--info-soft) 60%, var(--danger-soft));
    --st-ink: color-mix(in oklab, var(--info) 60%, var(--danger));
  }
  .st-delivered {
    --st: var(--success-soft);
    --st-ink: var(--success);
  }
  @media (prefers-color-scheme: dark) {
    .st-placed {
      --st-ink: var(--spark);
    }
  }
  .age,
  .meta span {
    display: inline-flex;
    align-items: center;
    gap: calc(4 * var(--u));
    color: var(--ink-muted);
    font-size: calc(13 * var(--u));
  }
  .items {
    margin: calc(12 * var(--u)) 0 0;
    padding: 0;
    list-style: none;
  }
  .items li {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: calc(12 * var(--u));
    margin-top: calc(12 * var(--u));
  }
  .meta b {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .meta span {
    font-size: calc(15 * var(--u));
  }

  .prep {
    margin-top: calc(16 * var(--u));
  }
  .prep p {
    margin-bottom: calc(6 * var(--u));
    color: var(--ink-muted);
    font-size: calc(13 * var(--u));
  }
  .preps {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: calc(6 * var(--u));
  }
  .preps button {
    min-height: max(44px, calc(44 * var(--u)));
    min-width: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--ink);
    font: 600 calc(15 * var(--u)) / 1 var(--font-sans);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition:
      background var(--duration-quick) var(--ease-soft),
      box-shadow var(--duration-quick) var(--ease-soft);
  }
  .preps button:hover {
    background: var(--hover);
  }
  .preps button[aria-checked='true'] {
    background: var(--spark);
    color: var(--on-spark);
    box-shadow: inset 0 0 0 1px var(--spark);
  }
  /* a small phone: three chips share the row so each stays a full finger wide */
  @container (max-width: 240px) {
    .preps {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .go {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: calc(8 * var(--u));
    width: 100%;
    min-height: max(44px, calc(56 * var(--u)));
    margin-top: calc(16 * var(--u));
    border: 0;
    border-radius: calc(14 * var(--u));
    background: var(--surface-sunken);
    color: var(--ink);
    font: 600 calc(15 * var(--u)) / 1.1 var(--font-sans);
    cursor: pointer;
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .go:hover {
    background: var(--press);
  }
  .go.first {
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: var(--shadow-e1);
  }
  .go.first:hover {
    background: var(--primary-hover);
  }
  .mins {
    opacity: 0.8;
    font-variant-numeric: tabular-nums;
  }
  .preps button:focus-visible,
  .go:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .go.first:focus-visible {
    outline-color: var(--spark);
    box-shadow: 0 0 0 4px var(--primary);
  }

  .toast {
    position: absolute;
    left: calc(16 * var(--u));
    right: calc(16 * var(--u));
    bottom: calc(20 * var(--u));
    display: flex;
    align-items: center;
    gap: calc(10 * var(--u));
    min-height: calc(52 * var(--u));
    padding: calc(8 * var(--u)) calc(14 * var(--u));
    border-radius: calc(14 * var(--u));
    background: var(--ink);
    color: var(--bg);
    box-shadow: var(--shadow-e3);
    font-weight: 600;
    animation: up var(--duration-smooth) var(--ease-soft);
  }
  .toast :global(svg) {
    color: var(--spark);
  }
  @media (prefers-color-scheme: dark) {
    .toast {
      background: var(--surface-raised);
      color: var(--ink);
    }
  }
  @keyframes up {
    from {
      opacity: 0;
      transform: translateY(30%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .app,
    .toast {
      animation: none;
    }
  }
</style>
