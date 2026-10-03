<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import LockScreen from '$lib/components/LockScreen.svelte';
  import Notification from '$lib/components/Notification.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import { clock } from '../clock';
  import Customer from './Customer.svelte';
  import Store from './Store.svelte';
  import {
    hm,
    LABEL,
    NEXT,
    order,
    PATH,
    PREP_DEFAULT,
    promise,
    times,
    TOAST,
    type Prep,
    type State,
  } from './script';

  // Two phones, one order: the store's (lock screen, then the admin's Pedidos screen) and Luiz's
  // (the store's order page). The visitor moves the order on the store's phone; a moment later
  // Luiz's page follows, as the live order page does. `final` is the still, finished state shown
  // before hydration and without JavaScript.
  let { final = false, reduced = false }: { final?: boolean; reduced?: boolean } = $props();

  const c = clock(() => reduced);
  onDestroy(c.stop);

  // svelte-ignore state_referenced_locally
  let shop = $state<'lock' | State>(final ? 'delivered' : 'lock');
  // svelte-ignore state_referenced_locally
  let luiz = $state<State>(final ? 'delivered' : 'placed');
  let prep = $state<Prep>(PREP_DEFAULT);
  let toast = $state<string | null>(null);
  let said = $state('');
  let root: HTMLDivElement;

  const at = $derived(times(prep));
  const now = $derived(shop === 'lock' ? at.placed : at[shop]);
  const events = $derived(
    PATH.slice(0, PATH.indexOf(luiz) + 1).map((s) => ({ state: s, at: at[s] })),
  );
  const guide = $derived(
    final
      ? null
      : shop === 'lock'
        ? 'Toque no aviso do pedido.'
        : shop === 'placed'
          ? 'Escolha o tempo de preparo e toque em aceitar.'
          : shop === 'delivered'
            ? 'Pedido entregue. Quer ver de novo? Toque em recomeçar.'
            : `Toque em ${NEXT[shop]}.`,
  );

  async function open() {
    shop = 'placed';
    said = `Celular da loja: pedido #${order.number} aberto. Escolha o tempo de preparo.`;
    await tick();
    root.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
  }

  async function advance() {
    if (shop === 'lock' || shop === 'delivered') return;
    const to = PATH[PATH.indexOf(shop) + 1]!;
    shop = to;
    const note = TOAST[to] ?? '';
    toast = note;
    said = `Celular da loja: ${note.replace(' ✓', '')}.`;
    if (to === 'delivered') {
      await tick();
      root.closest('figure')?.querySelector<HTMLElement>('.restart')?.focus();
    }
    void hideToast(note);
    await c.wait(900);
    if (PATH.indexOf(to) <= PATH.indexOf(luiz)) return;
    luiz = to;
    const p = promise(to, prep);
    said = `Celular do ${order.customer}: ${LABEL[to]}${to === 'delivered' ? '' : `, chega entre ${hm(p.from)} e ${hm(p.to)}`}.`;
  }

  async function hideToast(note: string) {
    if (reduced) return;
    await c.wait(2400);
    if (toast === note) toast = null;
  }
</script>

<div class="play" bind:this={root}>
  <div class="duo">
    <div class="dev shop">
      <Phone width={280} time={hm(now)} status={shop !== 'lock'}>
        {#if shop === 'lock'}
          <LockScreen time={hm(now)}>
            <div class="push">
              <Notification
                number={order.number}
                customer={order.customer}
                total={order.total}
                mode={order.mode}
                variant="lock"
                fresh
              />
              <button type="button" class="tap" onclick={open}>
                <span class="sr-only">Abrir o pedido #{order.number}</span>
              </button>
            </div>
          </LockScreen>
        {:else}
          <Store
            state={shop}
            at={now}
            {prep}
            {toast}
            onPrep={final ? undefined : (p) => (prep = p)}
            onNext={final ? undefined : advance}
          />
        {/if}
      </Phone>
      <p class="cap">Celular da loja</p>
    </div>
    <div class="dev luiz">
      <Phone width={240} time={hm(now)}>
        <Customer state={luiz} {prep} {events} />
      </Phone>
      <p class="cap">Celular do {order.customer}</p>
    </div>
  </div>
  {#if guide}<p class="guide">{guide}</p>{/if}
  <p class="sr-only" aria-live="polite">{said}</p>
</div>

<style>
  /* as wide as the stage allows, up to 560 px: a 0–560 px track gives the frame (which shrinks to
     fit its content) a max-content of 560 and a min-content of 0 */
  .play {
    display: grid;
    grid-template-columns: minmax(0, 560px);
    gap: 14px;
    justify-items: center;
  }
  .duo {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    gap: 3%;
  }
  .dev {
    display: grid;
    gap: 10px;
    justify-items: center;
  }
  .shop {
    width: 56%;
    max-width: 280px;
  }
  .luiz {
    width: 41%;
    max-width: 240px;
    margin-top: 9%;
  }
  .cap {
    margin: 0;
    font-size: 0.875rem;
    color: var(--ink-muted);
  }
  .guide {
    margin: 0;
    min-height: 1.5em;
    font-weight: 600;
    text-align: center;
  }
  .push {
    position: relative;
  }
  .tap {
    position: absolute;
    inset: 0;
    min-height: 44px;
    border: 0;
    border-radius: 6.4cqw;
    background: transparent;
    cursor: pointer;
  }
  .tap:hover {
    background: rgb(255 255 255 / 0.08);
  }
  .tap:focus-visible {
    outline: 2px solid var(--spark);
    outline-offset: 2px;
  }
</style>
