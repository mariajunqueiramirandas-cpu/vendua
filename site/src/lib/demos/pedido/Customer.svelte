<script lang="ts">
  import { store } from '$lib/content';
  import { hm, LABEL, order, PATH, promise, stamp, type Prep, type State } from './script';

  // Luiz's phone: the store's order page (packages/kernel/src/pages/order.tsx with ui-defaults'
  // OrderStatusPage + OrderTimeline): the state in the shopper's words, the promised window, the
  // progress track (labels hidden on a phone, as the default CSS does under 480 px), the timeline
  // and the order's facts. 1 --u ≈ 1 px of a 290 px phone.
  let {
    state,
    prep,
    events,
  }: {
    state: State;
    prep: Prep;
    events: { state: State; at: number }[];
  } = $props();

  const at = $derived(PATH.indexOf(state));
  const window = $derived(promise(state, prep));
</script>

<div class="page">
  <div class="bar" aria-hidden="true">
    <span class="logo">BN</span>
    <span>{store.name}</span>
  </div>
  <div class="body">
    <p class="kicker">Pedido #{order.number}</p>
    <p class="state">{LABEL[state]}</p>
    {#if state !== 'delivered'}
      <p class="muted">Chega entre {hm(window.from)} e {hm(window.to)}</p>
    {/if}

    <ol class="track" aria-hidden="true">
      {#each PATH as s, i (s)}
        <li
          class:done={i < at || state === 'delivered'}
          class:now={i === at && state !== 'delivered'}
        ></li>
      {/each}
    </ol>

    <ol class="timeline">
      {#each events as e, i (e.state)}
        <li class:now={i === events.length - 1}>
          <b>{LABEL[e.state]}</b>
          <span class="muted">{stamp(e.at)}</span>
        </li>
      {/each}
    </ol>

    <dl class="facts">
      <div>
        <dt>Entrega</dt>
        <dd>{order.address}</dd>
      </div>
      <div>
        <dt>Pagamento</dt>
        <dd>{order.payment}</dd>
      </div>
      <div>
        <dt>Total</dt>
        <dd class="num">{order.total}</dd>
      </div>
    </dl>
  </div>
</div>

<style>
  .page {
    /* the store's own colour (Bolos da Nena's warm caramel), from the shared tokens */
    --acc: var(--warning);
    --u: calc(93.6cqw / 290);
    height: calc(93.6cqw * 856 / 375 - 11cqw);
    overflow: hidden;
    background: var(--surface);
    color: var(--ink);
    font: 400 calc(14 * var(--u)) / 1.4 var(--font-sans);
    text-align: left;
  }
  p {
    margin: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: calc(8 * var(--u));
    height: calc(48 * var(--u));
    padding: 0 calc(16 * var(--u));
    border-bottom: 1px solid var(--line);
    font-weight: 700;
    font-size: calc(15 * var(--u));
  }
  .logo {
    display: grid;
    place-items: center;
    width: calc(28 * var(--u));
    height: calc(28 * var(--u));
    border-radius: 50%;
    background: var(--acc);
    color: var(--surface);
    font: 700 calc(11 * var(--u)) / 1 var(--font-display);
  }
  .body {
    padding: calc(18 * var(--u)) calc(16 * var(--u));
  }
  .kicker {
    color: var(--ink-muted);
    font-size: calc(13 * var(--u));
    font-weight: 600;
  }
  .state {
    margin: calc(2 * var(--u)) 0 calc(4 * var(--u));
    font: 700 calc(26 * var(--u)) / 1.15 var(--font-sans);
    letter-spacing: -0.01em;
  }
  .muted {
    color: var(--ink-muted);
  }
  .track {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: calc(6 * var(--u));
    margin: calc(16 * var(--u)) 0 calc(22 * var(--u));
    padding: 0;
    list-style: none;
  }
  .track li {
    height: calc(6 * var(--u));
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 10%, transparent);
    transition: background var(--duration-smooth) var(--ease-soft);
  }
  .track li.done {
    background: var(--acc);
  }
  .track li.now {
    background: linear-gradient(
      90deg,
      var(--acc) 0 55%,
      color-mix(in srgb, var(--acc) 35%, transparent) 55%
    );
  }
  .timeline {
    display: grid;
    gap: calc(12 * var(--u));
    margin: 0;
    padding: 0 0 0 calc(18 * var(--u));
    list-style: none;
    border-left: 2px solid color-mix(in srgb, var(--acc) 30%, transparent);
    font-size: calc(13 * var(--u));
  }
  .timeline li {
    position: relative;
    display: grid;
    animation: in var(--duration-smooth) var(--ease-soft);
  }
  .timeline li::before {
    content: '';
    position: absolute;
    left: calc(-25 * var(--u));
    top: 0.3em;
    width: calc(10 * var(--u));
    height: calc(10 * var(--u));
    border-radius: 50%;
    background: var(--surface);
    border: 2px solid var(--acc);
  }
  .timeline li.now::before {
    background: var(--acc);
  }
  .timeline b {
    font-weight: 600;
  }
  .timeline .muted {
    font-size: calc(12 * var(--u));
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .facts {
    display: grid;
    gap: calc(10 * var(--u));
    margin: calc(22 * var(--u)) 0 0;
    padding-top: calc(16 * var(--u));
    border-top: 1px solid var(--line);
    font-size: calc(13 * var(--u));
  }
  dt {
    color: var(--ink-muted);
    font-size: calc(12 * var(--u));
  }
  dd {
    margin: 0;
    font-weight: 600;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) {
    .timeline li {
      animation: none;
    }
  }
</style>
