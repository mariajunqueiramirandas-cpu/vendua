<script lang="ts">
  import Placa from './Placa.svelte';
  import { bagNote, coreMoment, money, PREP_MINUTES, signWords, when, type Status } from './rules';

  // The store's page as the shopper sees it, inside the shop's door: the sign, the banner at the
  // top (Core's notices.ts wording, the Kernel's PauseNotice / StoreClosedNotice), two products and
  // the bag. Paused: "Adicionar" is off (AddToCart). Closed: the bag fills, checkout waits.
  let {
    status,
    now,
    message,
    demand,
    label,
    reduced,
  }: {
    status: Status;
    now: number;
    message: string;
    demand: boolean;
    label: string;
    reduced: boolean;
  } = $props();

  const PRODUCTS = [
    { id: 'fatia', name: 'Fatia de cenoura com brigadeiro', cents: 900 },
    { id: 'bolo', name: 'Bolo de cenoura com brigadeiro', cents: 4500 },
  ];

  let bag = $state<Record<string, number>>({ fatia: 2 });
  let hidden = $state<string | null>(null);

  const sign = $derived(signWords(status, now));
  const count = $derived(Object.values(bag).reduce((a, b) => a + b, 0));
  const cents = $derived(PRODUCTS.reduce((a, p) => a + (bag[p.id] ?? 0) * p.cents, 0));
  const showDemand = $derived(demand && status.kind !== 'paused');

  const notice = $derived.by(() => {
    if (status.kind === 'paused') {
      const body =
        message.trim() ||
        (status.resumesAt !== null
          ? `Voltamos a aceitar pedidos ${coreMoment(status.resumesAt)}.`
          : null);
      return {
        id: 'paused',
        title: 'Estamos pausados no momento',
        body,
        meta: status.resumesAt !== null ? `Volta ${when(status.resumesAt, now)}` : null,
        closable: false,
      };
    }
    if (status.kind === 'closed')
      return {
        id: 'closed',
        title: 'Fechado agora',
        body:
          status.opensAt !== null
            ? `Abrimos ${coreMoment(status.opensAt)}. Você já pode montar sua sacola.`
            : 'Estamos fechados no momento.',
        meta: null,
        closable: true,
      };
    return null;
  });

  const add = (id: string) => (bag = { ...bag, [id]: (bag[id] ?? 0) + 1 });
</script>

<div class="door">
  <p class="moment" aria-live="polite">{label}</p>
  <div class="glass">
    <div class="sign">
      <Placa
        word={sign.word}
        rest={sign.rest}
        tag={showDemand ? 'Muitos pedidos agora' : null}
        {reduced}
      />
    </div>
    <div class="page">
      <p class="url">bolosdanena.vendua.com.br</p>
      <p class="name"><span class="logo" aria-hidden="true">B</span>Bolos da Nena</p>

      {#if notice && hidden !== notice.id}
        <div class="notice" class:blocking={!notice.closable} role="status">
          <p class="nt">{notice.title}</p>
          {#if notice.body}
            <p class="nb">{notice.body}</p>
          {:else}
            <p class="nb fallback">
              Sem recado, a loja mostra uma frase padrão. Vale escrever o seu.
            </p>
          {/if}
          {#if notice.meta}<p class="nm">{notice.meta}</p>{/if}
          {#if notice.closable}
            <button
              type="button"
              class="x"
              aria-label="fechar o aviso"
              onclick={() => (hidden = notice.id)}>×</button
            >
          {/if}
        </div>
      {/if}
      {#if showDemand && hidden !== 'demand'}
        <div class="notice warm" role="status">
          <p class="nt">Muitos pedidos agora</p>
          <p class="nb">
            O preparo está levando mais que os ~{PREP_MINUTES} min de sempre. Seu pedido entra na fila
            normalmente.
          </p>
          <button
            type="button"
            class="x"
            aria-label="fechar o aviso"
            onclick={() => (hidden = 'demand')}>×</button
          >
        </div>
      {/if}

      <ul class="products">
        {#each PRODUCTS as p (p.id)}
          <li>
            <span class="photo" aria-hidden="true"></span>
            <span class="pn">{p.name}<span class="pp">{money(p.cents)}</span></span>
            <button
              type="button"
              class="add"
              disabled={status.kind === 'paused'}
              aria-label={status.kind === 'paused'
                ? `Adicionar ${p.name}: desligado com a loja pausada`
                : `Adicionar ${p.name}`}
              onclick={() => add(p.id)}>Adicionar</button
            >
          </li>
        {/each}
      </ul>

      <div class="bagbar" aria-live="polite">
        <p class="bagline">
          <strong>Sacola</strong>: {count}
          {count === 1 ? 'item' : 'itens'}, {money(cents)}
        </p>
        {#if status.kind === 'paused'}
          <p class="bagnote">
            Pausada: não entra nada novo, e finalizar fica para quando ela voltar.
          </p>
        {:else if status.kind === 'closed' && count > 0}
          <p class="bagnote">{bagNote(status.opensAt, now, false)}</p>
        {:else if status.kind === 'open'}
          <p class="bagnote ok">Dá para finalizar o pedido.</p>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .door {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  div.door p {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink);
  }
  div.door p.moment {
    font-weight: 650;
    color: var(--ink-muted);
    text-align: center;
  }
  /* the door: a thick frame around the glass, the sign hanging inside it */
  .glass {
    position: relative;
    padding: 6px 8px 12px;
    border: 10px solid color-mix(in srgb, var(--ink) 78%, var(--surface));
    border-bottom-width: 18px;
    border-radius: 120px 120px 14px 14px;
    background: color-mix(in srgb, var(--info-soft) 55%, var(--bg));
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .sign {
    position: relative;
    z-index: 1;
    padding-top: 4px;
    max-width: 13.5rem;
    margin-inline: auto;
  }
  .page {
    display: grid;
    gap: 10px;
    margin-top: 12px;
    padding: 12px 10px;
    border-radius: 12px;
    container-type: inline-size;
    background: var(--surface);
    box-shadow: var(--shadow-e1);
  }
  div.door p.url {
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--surface-sunken);
    color: var(--ink-muted);
    font-size: 0.75rem;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  div.door p.name {
    display: flex;
    align-items: center;
    gap: 8px;
    font: 600 1rem/1.2 var(--font-display);
  }
  .logo {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--primary);
    color: var(--on-primary);
    font-size: 0.8125rem;
  }
  .notice {
    position: relative;
    padding: 10px 34px 10px 12px;
    border-radius: 10px;
    background: var(--surface-sunken);
    border-left: 4px solid var(--ink-muted);
  }
  .notice.blocking {
    padding-right: 12px;
    background: var(--warning-soft);
    border-left-color: var(--warning);
  }
  .notice.warm {
    background: var(--warning-soft);
    border-left-color: var(--warning);
  }
  div.door p.nt {
    font-weight: 700;
  }
  div.door p.nb {
    margin-top: 2px;
    overflow-wrap: anywhere;
  }
  div.door p.nb.fallback {
    color: var(--ink-muted);
  }
  div.door p.nm {
    margin-top: 4px;
    font-weight: 650;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .x {
    position: absolute;
    top: 0;
    right: 0;
    width: 44px;
    height: 44px;
    border: 0;
    background: none;
    color: var(--ink-muted);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 10px;
  }
  .products {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .products li {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--ink);
  }
  .photo {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    background:
      radial-gradient(circle at 35% 30%, var(--warning-soft) 0 30%, transparent 31%),
      color-mix(in srgb, var(--warning) 35%, var(--surface-sunken));
  }
  @container (max-width: 250px) {
    .products li {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .photo {
      display: none;
    }
  }
  .pn {
    display: grid;
    min-width: 0;
    font-weight: 600;
  }
  .pp {
    font-weight: 500;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .add {
    min-height: 44px;
    padding: 0 10px;
    border: 0;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font: 600 0.8125rem/1 var(--font-sans);
    cursor: pointer;
  }
  .add:disabled {
    background: var(--surface-sunken);
    color: var(--ink-muted);
    cursor: not-allowed;
    text-decoration: line-through;
  }
  .bagbar {
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  div.door p.bagline {
    font-variant-numeric: tabular-nums;
  }
  div.door p.bagnote {
    margin-top: 4px;
    color: var(--ink-muted);
  }
  div.door p.bagnote.ok {
    color: var(--success);
    font-weight: 600;
  }
  .add:focus-visible,
  .x:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  @media (prefers-color-scheme: dark) {
    .glass {
      background: color-mix(in srgb, var(--info-soft) 40%, var(--bg));
      border-color: color-mix(in srgb, var(--ink) 22%, var(--surface));
    }
  }
</style>
