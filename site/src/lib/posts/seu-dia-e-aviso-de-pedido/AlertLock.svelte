<script lang="ts">
  import LockScreen from '$lib/components/LockScreen.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import { push } from '$lib/content';
  import Store from '$lib/demos/pedido/Store.svelte';
  import { order, PREP_DEFAULT, TOAST, type Prep } from '$lib/demos/pedido/script';
  import { onMount } from 'svelte';
  import PushNote from './PushNote.svelte';

  // Order #29 reaching a locked phone with Core's real push (workers.ts pushOrder). Two ways in,
  // as the admin's service worker (apps/admin/sw.js) does them: "aceitar" on the notification
  // accepts it without opening the app and answers with its own "Pedido aceito" notification;
  // touching the notification opens the order card with the prep chips (ui/OrderCard.tsx).
  type View = 'push' | 'accepted' | 'card' | 'card-accepted';

  let view = $state<View>('push');
  let prep = $state<Prep>(PREP_DEFAULT);
  let live = $state(false);
  onMount(() => (live = true));

  /** 19h12 in minutes; accepted a minute later */
  const PLACED = 19 * 60 + 12;
  const ACCEPTED = PLACED + 1;
  /** the Centro zone's delivery estimate (example), added to the prep time on accept */
  const ETA = { min: 20, max: 30 };
  const hh = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  const promise = $derived({
    from: hh(ACCEPTED + prep + ETA.min),
    to: hh(ACCEPTED + prep + ETA.max),
  });

  /** the Store demo's own clock starts at 12h04; it only shows the card's age from it */
  const STORE_PLACED = 12 * 60 + 4;
</script>

<figure class="alert">
  <div class="stage">
    <div class="alert-phone">
      {#if view === 'push' || view === 'accepted'}
        <Phone width={270} status={false}>
          <LockScreen time="19:12" date="terça-feira, 29 de setembro">
            {#if view === 'push'}
              <PushNote
                title={push.title(order.number)}
                body={push.body(order)}
                onOpen={() => (view = 'card')}
                onAccept={() => (view = 'accepted')}
              />
            {:else}
              <PushNote title="Pedido aceito" body={'Já está em "aceitos". Bom trabalho!'} />
            {/if}
          </LockScreen>
        </Phone>
      {:else}
        <Phone width={270} time="19:13">
          <Store
            state={view === 'card' ? 'placed' : 'confirmed'}
            at={view === 'card' ? STORE_PLACED : STORE_PLACED + 1}
            {prep}
            toast={view === 'card' ? null : TOAST.confirmed!}
            onPrep={(p) => (prep = p)}
            onNext={() => (view = 'card-accepted')}
          />
        </Phone>
      {/if}
    </div>

    <div class="side" aria-live="polite">
      {#if view === 'push'}
        <p class="lead">O aviso chega com a tela travada.</p>
        <p>
          Ele toca e vibra mesmo com o app fechado. Toque em <strong>{push.action}</strong> para aceitar
          sem abrir o app, ou no próprio aviso para abrir o pedido e escolher o tempo de preparo.
        </p>
      {:else if view === 'accepted'}
        <p class="lead">Aceito sem abrir o app.</p>
        <p>
          O pedido vai para “aceitos” e segue com o tempo de preparo de sempre da loja, o mesmo que
          o cliente viu ao pedir: {PREP_DEFAULT} minutos na Bolos da Nena.
        </p>
      {:else if view === 'card'}
        <p class="lead">O pedido aberto, pronto para aceitar.</p>
        <p>
          Escolha em quanto tempo fica pronto: 15, 30 ou 45 minutos. O {PREP_DEFAULT}, o tempo de
          sempre da loja, já vem marcado.
        </p>
      {:else}
        <p class="lead">Aceito, com {prep} minutos de preparo.</p>
        <p>
          A previsão que o cliente vê muda junto: entrega entre {promise.from} e {promise.to},
          contando o tempo de entrega até o Centro.
        </p>
      {/if}
      {#if live && view !== 'push'}
        <button
          type="button"
          class="again"
          onclick={() => ((view = 'push'), (prep = PREP_DEFAULT))}
        >
          ver o aviso de novo
        </button>
      {/if}
    </div>
  </div>
  <figcaption>
    Simulação com a Bolos da Nena. O texto do aviso é o que a Venduá manda de verdade.
  </figcaption>
</figure>

<style>
  figure.alert {
    margin: 12px 0;
    display: grid;
    gap: 16px;
  }
  .stage {
    display: grid;
    justify-items: center;
    gap: 20px;
    padding: 24px 16px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }
  .alert-phone {
    width: min(270px, 100%);
    max-width: 100%;
    display: grid;
    justify-items: center;
  }
  /* Prose sizes every <p>/<li> in the post (.prose p beats a component's one-class rules): the
     drawn lock screen and Pedidos screen get their own sizes back */
  figure.alert .alert-phone :global(p),
  figure.alert .alert-phone :global(li) {
    font-size: inherit;
    line-height: inherit;
    color: inherit;
  }
  figure.alert .alert-phone :global(.app ul) {
    display: block;
    padding: 0;
  }
  figure.alert .alert-phone :global(.lock .date) {
    font: 600 4.6cqw/1.2 var(--font-sans);
  }
  figure.alert .alert-phone :global(.lock .time) {
    font: 600 25cqw/1 var(--font-display);
  }
  figure.alert .alert-phone :global(.app .title) {
    font: 600 calc(28 * var(--u)) / 1.2 var(--font-display);
  }
  figure.alert .alert-phone :global(.app .num) {
    font: 600 calc(38 * var(--u)) / 1 var(--font-display);
  }
  figure.alert .alert-phone :global(.app .who) {
    font-size: calc(17 * var(--u));
  }
  figure.alert .alert-phone :global(.app .prep p) {
    font-size: calc(13 * var(--u));
    color: var(--ink-muted);
  }
  figure.alert .alert-phone :global(.app .toast) {
    color: var(--bg);
  }
  @media (prefers-color-scheme: dark) {
    figure.alert .alert-phone :global(.app .toast) {
      color: var(--ink);
    }
  }
  .side {
    display: grid;
    align-content: center;
    gap: 8px;
    max-width: 30rem;
  }
  figure.alert .side p {
    margin: 0;
    font-size: 1rem;
    line-height: 1.6;
  }
  figure.alert .side .lead {
    font: 600 1.1875rem/1.35 var(--font-display);
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .again {
    justify-self: start;
    min-height: 44px;
    margin-top: 6px;
    padding: 0 18px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.9375rem/1 var(--font-sans);
    cursor: pointer;
  }
  .again:hover {
    background: var(--hover);
  }
  .again:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  figure.alert figcaption {
    max-width: none;
  }
  @media (min-width: 640px) {
    .stage {
      grid-template-columns: 270px minmax(0, 1fr);
      justify-items: start;
      align-items: center;
      gap: 28px;
      padding: 28px;
    }
  }
</style>
