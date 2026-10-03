<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import Dua from '$lib/components/Dua.svelte';
  import Tablet from '$lib/components/Tablet.svelte';
  import { clock } from '../clock';
  import Icon from './Icon.svelte';
  import Ticket from './Ticket.svelte';
  import { byDue, count, luiz, midService, opening, timing, type Order } from './script';

  // The admin's kitchen screen (apps/admin/src/features/kitchen/Kitchen.tsx), simplified: the top
  // bar with its counts, "Chegando" for orders still to accept, the tickets by due time and
  // "Prontos no balcão". Before hydration it's the board mid-service; live, it starts with two
  // tickets cooking and Luiz's order arriving.
  let { live, reduced }: { live: boolean; reduced: boolean } = $props();

  const UNDO_MS = 3000;
  const PREPS = [15, 30, 45];
  const PREP_DEFAULT = 30;

  let orders = $state<Order[]>(midService());
  let sec = $state(0);
  let nowMs = $state(0);
  let bumps = $state<Record<string, number>>({});
  let status = $state('');
  let menu = $state<string | null>(null);
  let board: HTMLElement | undefined = $state();
  let row: HTMLElement | undefined = $state();
  let opener: HTMLElement | null = null;
  let t0 = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const c = clock(() => reduced);

  const incoming = $derived(orders.filter((o) => o.stage === 'placed'));
  const queue = $derived(
    orders.filter((o) => o.stage === 'confirmed' || o.stage === 'preparing').sort(byDue(sec)),
  );
  const ready = $derived(
    orders.filter((o) => o.stage === 'ready').sort((a, b) => a.readyAt - b.readyAt),
  );
  const late = $derived(queue.filter((o) => timing(o, sec).urgency === 'late').length);
  const menuOrder = $derived(menu ? orders.find((o) => o.id === menu) : undefined);
  // the board's own clock, a quiet afternoon
  const hhmm = $derived.by(() => {
    const m = 15 * 60 + 20 + Math.floor(sec / 60);
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  });

  $effect(() => {
    if (live) untrack(start);
  });
  onDestroy(() => {
    c.stop();
    clearInterval(timer);
  });

  function start() {
    orders = opening();
    t0 = Date.now();
    nowMs = t0;
    sec = 0;
    status = 'Toque em cada item quando ele ficar feito.';
    timer = setInterval(() => {
      nowMs = Date.now();
      sec = Math.floor((nowMs - t0) / 1000);
    }, 250);
    void c.wait(2000).then(() => {
      orders.push(luiz(sec));
      status = 'Chegou o pedido #29. Aceite escolhendo o tempo de preparo.';
    });
  }

  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  const byId = (id: string) => orders.find((o) => o.id === id)!;
  const el = (id: string) => board?.querySelector<HTMLElement>(`[data-ticket="${id}"]`) ?? null;
  const holdsFocus = (node: Element | null | undefined) =>
    !!node && node.contains(document.activeElement);

  async function accept(id: string, prep: number) {
    const o = byId(id);
    const hadFocus = holdsFocus(board?.querySelector('.incoming'));
    Object.assign(o, { stage: 'confirmed', prep, clock: 0, at: sec, arriving: true });
    status = `Pedido #${o.number} aceito com ${prep} min. ${cap(o.who)} recebe o aviso no WhatsApp da loja.`;
    await tick();
    const t = el(id);
    if (t && row && row.scrollWidth > row.clientWidth)
      row.scrollTo({
        left: t.offsetLeft - row.offsetLeft - 12,
        behavior: reduced ? 'auto' : 'smooth',
      });
    if (hadFocus) t?.querySelector<HTMLElement>('.item')?.focus({ preventScroll: true });
  }

  function toggle(id: string, itemId: string) {
    const o = byId(id);
    const item = o.items.find((i) => i.id === itemId)!;
    item.done = !item.done;
    o.arriving = false;
    // the first mark starts the order (Core: admin/routes-kitchen.ts)
    if (o.stage === 'confirmed') o.stage = 'preparing';
    if (o.items.every((i) => i.done)) status = `Tudo feito no #${o.number}. Toque em pronto.`;
  }

  async function action(id: string) {
    const o = byId(id);
    o.arriving = false;
    if (o.stage === 'confirmed') {
      o.stage = 'preparing';
      status = `Pedido #${o.number} em preparo.`;
      return;
    }
    if (reduced) return finish(id);
    const end = Date.now() + UNDO_MS;
    bumps[id] = end;
    await c.wait(UNDO_MS);
    if (bumps[id] !== end) return;
    delete bumps[id];
    finish(id);
  }

  async function finish(id: string) {
    const o = byId(id);
    const hadFocus = holdsFocus(el(id));
    o.stage = 'ready';
    o.readyAt = sec;
    o.rush = false;
    status =
      o.mode === 'pickup'
        ? `Pedido #${o.number} pronto. ${cap(o.who)} recebe no WhatsApp da loja: “Seu pedido #${o.number} está pronto para retirar. Te esperamos!”`
        : `Pedido #${o.number} pronto, esperando o entregador. Quando ele sair para entrega, ${o.who} recebe o aviso no WhatsApp da loja.`;
    if (!queue.length && !incoming.length && orders.length === 3)
      status += ' Cozinha em dia: os três pedidos estão no balcão.';
    await tick();
    if (hadFocus) board?.querySelector<HTMLElement>('.item, .main')?.focus({ preventScroll: true });
  }

  function undo(id: string) {
    delete bumps[id];
    status = `#${byId(id).number} voltou para a fila`;
  }

  async function openMenu(id: string, from: HTMLElement) {
    opener = from;
    menu = id;
    await tick();
    board?.querySelector<HTMLElement>('.sheet button')?.focus();
  }
  function closeMenu() {
    menu = null;
    opener?.focus();
    opener = null;
  }
  function setRush(o: Order) {
    o.rush = !o.rush;
    status = o.rush ? `#${o.number} passou na frente.` : `#${o.number} sem prioridade.`;
    closeMenu();
  }
  function markAll(o: Order, done: boolean) {
    for (const i of o.items) i.done = done;
    o.arriving = false;
    if (done && o.stage === 'confirmed') o.stage = 'preparing';
    status = done
      ? `Tudo feito no #${o.number}. Toque em pronto.`
      : `Itens do #${o.number} desmarcados.`;
    closeMenu();
  }
  function onSheetKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    }
  }

  const left = (id: string) => Math.max(1, Math.ceil(((bumps[id] ?? 0) - nowMs) / 1000));
  const ago = (o: Order) =>
    sec - o.readyAt < 60 ? 'agora' : `há ${Math.floor((sec - o.readyAt) / 60)} min`;
</script>

<div class="kds" class:live>
  <Tablet>
    <div class="board" bind:this={board}>
      <header class="top">
        <p class="title">Cozinha</p>
        <span class="station"><span class="stack" aria-hidden="true"></span>Tudo</span>
        <p class="counts">
          {#if late}
            <span class="count c-late"
              ><b class="tnum">{late}</b>{late === 1 ? 'atrasado' : 'atrasados'}</span
            >
          {/if}
          <span class="count c-fila"
            ><b class="tnum">{queue.filter((o) => o.stage === 'confirmed').length}</b>na fila</span
          >
          <span class="count c-prep"
            ><b class="tnum">{queue.filter((o) => o.stage === 'preparing').length}</b>em preparo</span
          >
        </p>
        <p class="clock tnum">{hhmm}</p>
      </header>

      {#if incoming.length}
        <section class="incoming" aria-label="aguardando aceite">
          <p class="lbl">Chegando</p>
          {#each incoming as o (o.id)}
            <article class="in" aria-label="Pedido {o.number} aguardando aceite">
              <div class="in-who">
                <p class="in-n tnum">#{o.number}</p>
                <p class="in-sub">{count(o)} itens · agora</p>
              </div>
              <div class="preps" role="group" aria-label="aceitar #{o.number} com tempo de preparo">
                {#each PREPS as m (m)}
                  <button
                    type="button"
                    class="prep"
                    class:def={m === PREP_DEFAULT}
                    aria-label="aceitar com {m} minutos"
                    onclick={() => accept(o.id, m)}
                  >
                    <b class="tnum">{m}</b><span>min</span>
                  </button>
                {/each}
              </div>
            </article>
          {/each}
        </section>
      {/if}

      <div class="main" aria-label="pedidos na cozinha" role="region" tabindex="-1">
        {#if queue.length}
          <div class="row" bind:this={row}>
            {#each queue as o (o.id)}
              <div class="slot" data-ticket={o.id} animate:flip={{ duration: reduced ? 0 : 260 }}>
                <Ticket
                  order={o}
                  {sec}
                  {live}
                  bump={o.id in bumps ? left(o.id) : undefined}
                  onToggle={(itemId) => toggle(o.id, itemId)}
                  onAction={() => action(o.id)}
                  onMore={(from) => openMenu(o.id, from)}
                  onUndo={() => undo(o.id)}
                />
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty">
            <Dua pose="sucesso" size={96} style="width: 6.5em" />
            <p class="empty-t">Cozinha em dia</p>
            <p class="empty-s">
              Quando um pedido for aceito, ele aparece aqui na hora, com o tempo correndo.
            </p>
          </div>
        {/if}
      </div>

      <section class="ready" aria-label="prontos">
        <p class="lbl">Prontos no balcão <span class="n tnum">{ready.length}</span></p>
        {#if ready.length}
          <ul>
            {#each ready as o (o.id)}
              <li>
                <span class="r-ic"><Icon name={o.mode === 'delivery' ? 'moped' : 'bag'} /></span>
                <div class="r-who">
                  <p class="r-n tnum">#{o.number} <span>{o.name}</span></p>
                  <p class="r-s">
                    {o.mode === 'delivery' ? 'esperando o entregador' : 'esperando o cliente'}
                  </p>
                </div>
                <span class="r-ago">{ago(o)}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="none">Nada esperando no balcão.</p>
        {/if}
      </section>

      {#if menuOrder}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="scrim" onclick={closeMenu}></div>
        <div
          class="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cozinha-sheet-t"
          tabindex="-1"
          onkeydown={onSheetKey}
        >
          <p id="cozinha-sheet-t" class="sheet-t tnum">Pedido #{menuOrder.number}</p>
          <button
            type="button"
            class="sb"
            class:primary={!menuOrder.rush}
            onclick={() => setRush(menuOrder)}
          >
            <Icon name="fire" />
            {menuOrder.rush ? 'tirar a prioridade' : 'passar na frente (prioridade)'}
          </button>
          {#if menuOrder.items.some((i) => !i.done)}
            <button type="button" class="sb" onclick={() => markAll(menuOrder, true)}>
              <Icon name="check" /> marcar todos os itens como feitos
            </button>
          {/if}
          {#if menuOrder.items.some((i) => i.done)}
            <button type="button" class="sb ghost" onclick={() => markAll(menuOrder, false)}>
              desmarcar os itens feitos
            </button>
          {/if}
          <button type="button" class="sb ghost" onclick={closeMenu}>fechar</button>
        </div>
      {/if}
    </div>
  </Tablet>
  <p class="status" aria-live="polite">{status}</p>
</div>

<style>
  /* the demo frame centres its content at its own size, so the tablet takes the stage's width
     itself: the page column on phones, the hub's 7/12 column from 900 px */
  .kds {
    width: min(720px, calc(100vw - 2 * var(--gutter)));
    container: kds / inline-size;
  }
  .board {
    position: relative;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr);
    aspect-ratio: 5 / 4;
    /* clip, not hidden: focusing a ticket must never scroll the whole screen sideways */
    overflow: clip;
    background: var(--bg);
    color: var(--ink);
    font-size: clamp(11.5px, 2cqi, 15px);
    line-height: 1.35;
  }
  p {
    margin: 0;
  }
  button {
    font: inherit;
  }
  button:focus-visible,
  .main:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
    box-shadow: none;
  }

  /* ── top bar ── */
  .top {
    grid-row: 1;
    display: flex;
    align-items: center;
    gap: 0.6em;
    padding: 0.55em 0.9em;
    border-bottom: 1px solid var(--line);
    background: var(--glass);
  }
  .title {
    font-family: var(--font-display);
    font-size: 1.2em;
    font-weight: 600;
    letter-spacing: -0.015em;
  }
  .station {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    height: 2.3em;
    padding: 0 0.9em;
    border-radius: 999px;
    background: var(--surface);
    box-shadow:
      inset 0 0 0 1px var(--line-strong),
      var(--shadow-e1);
    font-size: 0.85em;
    font-weight: 600;
  }
  .stack {
    width: 0.9em;
    height: 0.9em;
    border-radius: 0.2em;
    box-shadow:
      inset 0 0 0 2px currentColor,
      0.18em -0.18em 0 -0.05em var(--surface),
      0.22em -0.22em 0 0 currentColor;
  }
  .counts {
    display: flex;
    flex: 1;
    gap: 0.4em;
    min-width: 0;
  }
  .count {
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    height: 2.3em;
    padding: 0 0.85em 0 0.3em;
    border-radius: 999px;
    font-size: 0.85em;
    font-weight: 600;
    white-space: nowrap;
  }
  .count b {
    display: grid;
    place-items: center;
    min-width: 1.7em;
    height: 1.7em;
    padding: 0 0.3em;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 70%, transparent);
    font-family: var(--font-display);
  }
  .count.c-fila {
    background: var(--info-soft);
    color: var(--info);
  }
  .count.c-prep {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .count.c-late {
    padding-left: 0.85em;
    background: var(--danger);
    color: var(--surface);
  }
  .count.c-late b {
    min-width: 0;
    background: none;
    padding: 0;
  }
  .clock {
    font-family: var(--font-display);
    font-size: 1.45em;
    font-weight: 600;
    line-height: 1;
  }

  /* ── chegando ── */
  .incoming {
    grid-row: 2;
    display: flex;
    align-items: center;
    gap: 0.7em;
    padding: 0.55em 0.9em;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--spark-soft) 60%, transparent);
    overflow-x: auto;
  }
  .lbl {
    font-size: 0.85em;
    font-weight: 600;
    white-space: nowrap;
  }
  .incoming .lbl {
    color: var(--ink);
  }
  .in {
    display: flex;
    align-items: center;
    gap: 0.7em;
    flex: none;
    padding: 0.4em 0.4em 0.4em 0.75em;
    border-radius: 0.75em;
    background: var(--surface);
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-e1);
  }
  .live .in {
    animation: drop 420ms var(--ease-soft);
  }
  .in-n {
    font-family: var(--font-display);
    font-size: 1.35em;
    font-weight: 600;
    line-height: 1;
  }
  .in-sub {
    margin-top: 0.3em;
    font-size: 0.75em;
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .preps {
    display: flex;
    gap: 0.25em;
  }
  .prep {
    display: grid;
    place-items: center;
    align-content: center;
    min-width: 3.3em;
    height: 3.3em;
    padding: 0 0.3em;
    border: 0;
    border-radius: 0.55em;
    background: var(--surface-sunken);
    color: var(--ink);
    line-height: 1;
    cursor: pointer;
  }
  .prep:hover {
    background: var(--press);
  }
  .prep.def {
    background: var(--primary);
    color: var(--on-primary);
  }
  .prep b {
    font-family: var(--font-display);
    font-size: 1.05em;
  }
  .prep span {
    font-size: 0.7em;
    font-weight: 600;
    opacity: 0.8;
  }

  /* ── tickets ── */
  .main {
    grid-row: 3;
    min-height: 0;
    overflow-y: auto;
    padding: 0.8em 0.9em;
    scrollbar-width: thin;
  }
  .row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: start;
    gap: 0.7em;
  }
  .empty {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 0.3em;
    height: 100%;
    padding: 0.5em 1em;
    text-align: center;
  }
  .empty-t {
    font-family: var(--font-display);
    font-size: 1.3em;
    font-weight: 600;
  }
  .empty-s {
    max-width: 26em;
    color: var(--ink-muted);
    font-size: 0.9em;
  }

  /* ── prontos ── */
  .ready {
    grid-row: 4;
    padding: 0.5em 0.9em 0.7em;
    border-top: 1px solid var(--line);
    background: color-mix(in srgb, var(--surface-sunken) 40%, var(--bg));
  }
  .ready .lbl {
    display: flex;
    align-items: center;
    gap: 0.5em;
    margin-bottom: 0.45em;
  }
  .n {
    padding: 0 0.55em;
    border-radius: 999px;
    background: var(--success-soft);
    color: var(--success);
  }
  .ready ul {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.7em;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ready li {
    display: flex;
    align-items: center;
    gap: 0.55em;
    min-width: 0;
    padding: 0.5em 0.6em;
    border-radius: 0.75em;
    background: var(--surface);
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-e1);
  }
  .live .ready li {
    animation: landed 1.8s var(--ease-soft);
  }
  .r-ic {
    display: grid;
    place-items: center;
    flex: none;
    width: 2.3em;
    height: 2.3em;
    border-radius: 50%;
    background: var(--success-soft);
    color: var(--success);
    font-size: 1.05em;
  }
  .r-ic :global(.ico) {
    font-size: 1.2em;
  }
  .r-who {
    flex: 1;
    min-width: 0;
  }
  .r-n {
    font-family: var(--font-display);
    font-size: 1.1em;
    font-weight: 600;
    line-height: 1.1;
    white-space: nowrap;
  }
  .r-n span {
    font-family: var(--font-sans);
    font-size: 0.8em;
    color: var(--ink-muted);
  }
  .r-s,
  .r-ago {
    font-size: 0.75em;
    color: var(--ink-muted);
  }
  .r-s {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .r-ago {
    align-self: flex-start;
    white-space: nowrap;
  }
  .none {
    min-height: 3.2em;
    display: flex;
    align-items: center;
    font-size: 0.85em;
    color: var(--ink-muted);
  }

  /* ── ⋯ sheet ── */
  .scrim {
    position: absolute;
    inset: 0;
    z-index: 5;
    background: rgb(10 16 13 / 0.4);
  }
  .sheet {
    position: absolute;
    inset: auto 0 0;
    z-index: 6;
    display: grid;
    gap: 0.45em;
    width: min(100%, 26em);
    margin-inline: auto;
    padding: 0.9em;
    border-radius: 1.1em 1.1em 0 0;
    background: var(--surface-raised);
    box-shadow: var(--shadow-e3);
  }
  .live .sheet {
    animation: rise 220ms var(--ease-soft);
  }
  .sheet-t {
    padding: 0 0.2em 0.2em;
    font-family: var(--font-display);
    font-size: 1.2em;
    font-weight: 600;
  }
  .sb {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.45em;
    min-height: 3.3em;
    padding: 0 1em;
    border: 0;
    border-radius: 0.6em;
    background: var(--surface-sunken);
    color: var(--ink);
    font-weight: 700;
    cursor: pointer;
  }
  .sb.primary {
    background: var(--primary);
    color: var(--on-primary);
  }
  .sb.ghost {
    background: none;
    font-weight: 600;
  }
  .sb:hover {
    filter: brightness(0.97);
  }

  .status {
    margin: 12px auto 0;
    max-width: 52ch;
    font-size: 0.9375rem;
    line-height: 1.5;
    text-align: center;
    color: var(--ink);
  }

  @media (min-width: 900px) {
    .kds {
      width: min(
        720px,
        calc(
          (
              min(100vw, var(--wrap) + 2 * var(--gutter)) - 2 * var(--gutter) -
                clamp(24px, 4vw, 56px)
            ) *
            7 / 12 - 8px
        )
      );
    }
  }

  .live .status {
    min-height: 4.5em;
  }

  /* ── phones: the board grows down, tickets side by side in a swipeable row ── */
  @container kds (max-width: 559px) {
    .board {
      aspect-ratio: auto;
      font-size: clamp(12.5px, 4.1cqi, 14.5px);
    }
    .top {
      flex-wrap: wrap;
      row-gap: 0.45em;
    }
    .title {
      flex: 1;
    }
    .counts {
      order: 3;
      flex-basis: 100%;
    }
    .main {
      min-height: 24em;
      padding-inline: 0;
      overflow: visible;
    }
    .row {
      display: flex;
      gap: 0.6em;
      padding-inline: 0.9em;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scroll-padding-inline: 0.9em;
      scrollbar-width: none;
    }
    .slot {
      flex: 0 0 84%;
      scroll-snap-align: start;
    }
    .ready ul {
      display: flex;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .ready li {
      flex: 0 0 72%;
    }
  }

  @container kds (min-width: 440px) and (max-width: 559px) {
    .slot {
      flex-basis: 62%;
    }
    .ready li {
      flex-basis: 48%;
    }
  }

  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-0.6em);
    }
  }
  @keyframes rise {
    from {
      transform: translateY(100%);
    }
  }
  @keyframes landed {
    from {
      box-shadow:
        0 0 0 3px var(--spark),
        var(--shadow-e1);
      background: var(--spark-soft);
    }
    60% {
      box-shadow:
        0 0 0 3px var(--spark),
        var(--shadow-e1);
      background: var(--spark-soft);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .live .in,
    .live .sheet {
      animation: none;
    }
    .live .ready li {
      animation-duration: 0s;
    }
  }
</style>
