<script lang="ts">
  import Icon from './Icon.svelte';
  import { WORD, minutes, stopwatch, timing, type Order } from './script';

  // One ticket, after apps/admin/src/features/kitchen/Ticket.tsx: the fuse burning down against the
  // prep time, number and clock big, every item a tap target, one button for the next step and,
  // after "pronto", a few seconds to take it back.
  let {
    order: o,
    sec,
    live,
    bump,
    onToggle,
    onAction,
    onMore,
    onUndo,
  }: {
    order: Order;
    sec: number;
    live: boolean;
    /** seconds left in the "pronto" undo window, while it runs */
    bump: number | undefined;
    onToggle: (itemId: string) => void;
    onAction: () => void;
    onMore: (el: HTMLElement) => void;
    onUndo: () => void;
  } = $props();

  const t = $derived(timing(o, sec));
  const done = $derived(o.items.filter((i) => i.done).length);
  const allDone = $derived(done === o.items.length);
  // the veil covers the button just pressed: the keyboard lands on "desfazer"
  function grab(node: HTMLElement) {
    if (node.closest('article')?.contains(document.activeElement)) node.focus();
  }
  const kind = $derived(o.stage === 'confirmed' ? 'start' : allDone ? 'beckon' : 'quiet');
</script>

<article
  class="ticket {t.urgency}"
  class:arriving={o.arriving}
  aria-label="Pedido {o.number}, {o.name}: {done} de {o.items.length} itens feitos, {WORD[
    t.urgency
  ]}{o.rush ? ', prioridade' : ''}"
>
  <div class="fuse" aria-hidden="true">
    <span style="width: {Math.min(100, Math.max(3, t.ratio * 100))}%"></span>
  </div>

  <header>
    <div class="who">
      <h4 class="num tnum">
        #{o.number}{#if o.rush}<span class="flame"><Icon name="fire" /></span>{/if}
      </h4>
      <p class="mode">
        <Icon name={o.mode === 'delivery' ? 'moped' : 'bag'} />
        <span>{o.mode === 'delivery' ? 'Entrega' : 'Retirada'} · {o.name}</span>
      </p>
    </div>
    <div class="time">
      <p class="face tnum">{stopwatch(t.elapsed)}</p>
      <p class="sub">{t.left < 0 ? `atrasado ${minutes(t.left)}` : `faltam ${minutes(t.left)}`}</p>
    </div>
    {#if o.arriving || o.rush || o.stage === 'confirmed'}
      <p class="tags">
        {#if o.arriving}<span class="tag novo">novo</span>{/if}
        {#if o.rush}<span class="tag rush"><Icon name="fire" /> prioridade</span>{/if}
        {#if o.stage === 'confirmed'}<span class="tag fila">na fila</span>{/if}
      </p>
    {/if}
  </header>

  <ul class="items">
    {#each o.items as i (i.id)}
      <li>
        {#snippet face()}
          <span class="qty tnum" class:many={i.qty > 1}>
            {#if i.done}<Icon name="check" /><span class="sr">feito</span>{:else}{i.qty}×{/if}
          </span>
          <span class="name">{i.done && i.qty > 1 ? `${i.qty}× ` : ''}{i.name}</span>
        {/snippet}
        {#if live}
          <button
            type="button"
            class="item"
            class:done={i.done}
            aria-pressed={i.done}
            onclick={() => onToggle(i.id)}>{@render face()}</button
          >
        {:else}
          <div class="item" class:done={i.done}>{@render face()}</div>
        {/if}
      </li>
    {/each}
  </ul>

  <footer>
    {#if o.items.length > 1 && done}
      <span class="progress tnum" aria-hidden="true">{done}/{o.items.length}</span>
    {/if}
    {#snippet label()}
      <Icon name={o.stage === 'confirmed' ? 'pot' : 'check'} />
      {o.stage === 'confirmed' ? 'começar' : 'pronto'}
    {/snippet}
    {#if live}
      <button type="button" class="act {kind}" onclick={onAction}>{@render label()}</button>
    {:else}
      <div class="act {kind}">{@render label()}</div>
    {/if}
    {#if live}
      <button
        type="button"
        class="more"
        aria-label="mais opções do pedido {o.number}"
        title="mais opções"
        onclick={(e) => onMore(e.currentTarget)}><Icon name="dots" /></button
      >
    {/if}
  </footer>

  {#if bump !== undefined}
    <div class="veil">
      <span class="badge"><Icon name="check" /></span>
      <p class="tnum">#{o.number} pronto</p>
      <button type="button" class="undo" onclick={onUndo} use:grab>
        <Icon name="undo" /> desfazer <span class="tnum">{bump}</span>
      </button>
      <span class="drain" aria-hidden="true"><span></span></span>
    </div>
  {/if}
</article>

<style>
  .ticket {
    container-type: inline-size;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 0.9em;
    background: var(--surface);
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-e1);
  }
  .ticket.warn {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--warning) 45%, transparent),
      var(--shadow-e1);
  }
  .ticket.late {
    box-shadow:
      0 0 0 2px var(--danger),
      var(--shadow-e1);
  }
  .fuse {
    height: 0.4em;
    background: var(--surface-sunken);
  }
  .fuse span {
    display: block;
    height: 100%;
    background: var(--success);
    transition: width 1s linear;
  }
  .warn .fuse span {
    background: var(--warning);
  }
  .late .fuse span {
    background: var(--danger);
  }

  header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'who time' 'tags tags';
    gap: 0 0.6em;
    padding: 0.7em 0.85em 0.75em;
  }
  /* a narrow ticket (three across the tablet): the name gets the whole line under the clock */
  @container (max-width: 17em) {
    header {
      grid-template-areas: 'num time' 'mode mode' 'tags tags';
    }
    .who {
      display: contents;
    }
    .num {
      grid-area: num;
      align-self: start;
    }
    .mode {
      grid-area: mode;
    }
  }
  .warn header {
    background: var(--warning-soft);
  }
  .late header {
    background: var(--danger-soft);
  }
  .who {
    grid-area: who;
    min-width: 0;
  }
  .num {
    display: flex;
    align-items: center;
    gap: 0.25em;
    font-family: var(--font-display);
    font-size: 1.75em;
    font-weight: 600;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .flame {
    color: var(--danger);
    font-size: 0.75em;
    display: inline-flex;
  }
  .mode {
    display: flex;
    align-items: center;
    gap: 0.35em;
    margin-top: 0.35em;
    font-size: 0.85em;
    font-weight: 600;
    line-height: 1.2;
    color: var(--ink-muted);
  }
  .mode span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time {
    grid-area: time;
    text-align: right;
    color: var(--success);
  }
  .warn .time {
    color: var(--warning);
  }
  .late .time {
    color: var(--danger);
  }
  .face {
    font-family: var(--font-display);
    font-size: 1.45em;
    font-weight: 600;
    line-height: 1;
  }
  .sub {
    margin-top: 0.4em;
    font-size: 0.75em;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
  }
  .tags {
    grid-area: tags;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35em;
    margin-top: 0.55em;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    height: 1.9em;
    padding: 0 0.7em;
    border-radius: 999px;
    font-size: 0.75em;
    font-weight: 700;
  }
  .novo {
    background: var(--spark);
    color: var(--on-spark);
  }
  .rush {
    background: var(--danger);
    color: var(--surface);
  }
  .fila {
    background: var(--info-soft);
    color: var(--info);
  }

  .items {
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--line);
  }
  .items li + li {
    border-top: 1px solid var(--line);
  }
  .item {
    display: flex;
    align-items: flex-start;
    gap: 0.6em;
    width: 100%;
    min-height: 3.4em;
    padding: 0.55em 0.85em;
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
  }
  button.item {
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-soft);
  }
  button.item:hover {
    background: var(--hover);
  }
  button.item:active {
    background: var(--press);
  }
  button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
    box-shadow: none;
  }
  .qty {
    display: grid;
    place-items: center;
    flex: none;
    min-width: 2.25em;
    height: 2.25em;
    padding: 0 0.3em;
    border-radius: 0.5em;
    background: var(--surface-sunken);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.05em;
  }
  .qty.many {
    background: var(--ink);
    color: var(--surface);
  }
  .done .qty {
    background: var(--success-soft);
    color: var(--success);
    font-size: 1.2em;
  }
  .name {
    min-width: 0;
    padding-top: 0.3em;
    font-weight: 700;
    line-height: 1.25;
  }
  .done .name {
    color: var(--ink-muted);
    text-decoration: line-through 2px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 0.45em;
    margin-top: auto;
    padding: 0.6em;
    border-top: 1px solid var(--line);
  }
  .progress {
    padding: 0 0.2em;
    font-size: 0.85em;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .act {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4em;
    height: 3.3em;
    border: 0;
    border-radius: 0.6em;
    font: inherit;
    font-weight: 700;
    font-size: 1em;
  }
  .act :global(.ico) {
    font-size: 1.3em;
  }
  button.act,
  .more {
    cursor: pointer;
  }
  .act.start {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .act.quiet {
    background: var(--surface-sunken);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .act.beckon {
    background: var(--spark);
    color: var(--on-spark);
  }
  .more {
    display: grid;
    place-items: center;
    flex: none;
    width: 3.3em;
    height: 3.3em;
    border: 0;
    border-radius: 0.6em;
    background: none;
    color: var(--ink-muted);
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: 1em;
  }
  .more :global(.ico) {
    font-size: 1.4em;
  }
  .more:hover {
    background: var(--hover);
  }

  .veil {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.8em;
    padding: 1em;
    background: var(--spark);
    color: var(--on-spark);
  }
  .badge {
    display: grid;
    place-items: center;
    width: 3.2em;
    height: 3.2em;
    border-radius: 50%;
    background: var(--on-spark);
    color: var(--spark);
    font-size: 1.1em;
  }
  .badge :global(.ico) {
    font-size: 1.7em;
  }
  .veil p {
    font-family: var(--font-display);
    font-size: 1.6em;
    font-weight: 600;
    line-height: 1;
  }
  .undo {
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    height: 3.3em;
    padding: 0 1.2em;
    border: 0;
    border-radius: 0.6em;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    box-shadow: var(--shadow-e2);
  }
  .undo .tnum {
    color: var(--ink-muted);
  }
  .drain {
    position: absolute;
    inset: auto 0 0;
    height: 0.4em;
    background: color-mix(in srgb, var(--on-spark) 15%, transparent);
  }
  .drain span {
    display: block;
    height: 100%;
    background: var(--on-spark);
    animation: drain 3s linear forwards;
  }
  .arriving {
    animation: drop 420ms var(--ease-soft);
  }
  @keyframes drain {
    from {
      width: 100%;
    }
    to {
      width: 0;
    }
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-0.8em);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .arriving,
    .drain span {
      animation: none;
    }
    .fuse span {
      transition: none;
    }
  }
</style>
