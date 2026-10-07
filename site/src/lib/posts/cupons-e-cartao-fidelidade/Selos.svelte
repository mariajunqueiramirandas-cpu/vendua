<script lang="ts">
  import { onMount } from 'svelte';
  import Ticket from './Ticket.svelte';
  import { brl, rewardWords, type Kind } from './rules';

  // The stamp card as Core keeps it (packages/core/src/modules/customer.ts): a stamp is a delivered
  // order, the card shows delivered minus what already became rewards, and each full card mints a
  // personal, single-use FIEL coupon valid for 60 days (the admin's rewardValidDays). Bia's history
  // below is example data; the rules are the real ones.

  type Event = 'delivered' | 'cancelled' | 'refunded' | 'days';
  interface Reward {
    code: string;
    /** a minted coupon keeps the reward it was minted with */
    kind: Kind;
    left: number;
    state: 'open' | 'used' | 'expired';
  }

  const VALID = 60;
  // codes in Core's shape: FIEL + 6 characters from its unambiguous alphabet
  const CODES = ['FIEL-7KQ2MX', 'FIEL-H3TZ9P', 'FIEL-W8NC4R', 'FIEL-R5JD6A', 'FIEL-M2XV8E'];

  let need = $state(10);
  let kind = $state<Kind>('fixed');
  let delivered = $state(7);
  let rewards = $state<Reward[]>([]);
  let log = $state<{ id: number; text: string; tone: 'ok' | 'no' | 'gift' }[]>([
    { id: 3, text: 'Pedido entregue: 7º selo.', tone: 'ok' },
    { id: 2, text: 'Pedido cancelado: sem selo.', tone: 'no' },
    { id: 1, text: 'Pedido entregue: 6º selo.', tone: 'ok' },
  ]);
  let seq = 4;
  let fresh = $state(-1);
  let reduced = $state(true);

  onMount(() => {
    reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  const minted = $derived(rewards.length);
  const stamps = $derived(Math.min(need, Math.max(0, delivered - minted * need)));
  const label = $derived(rewardWords(kind, kind === 'percent' ? 10 : 1500));
  const open = $derived(rewards.filter((r) => r.state === 'open'));

  const say = (text: string, tone: 'ok' | 'no' | 'gift') => {
    log = [{ id: seq++, text, tone }, ...log].slice(0, 4);
  };

  function act(e: Event) {
    if (e === 'delivered') {
      delivered++;
      // Core mints on delivery, as many rewards as the delivered orders now cover
      let n = minted;
      const got: string[] = [];
      while ((n + 1) * need <= delivered) {
        const code = CODES[n % CODES.length]!;
        rewards = [...rewards, { code, kind, left: VALID, state: 'open' }];
        got.push(code);
        n++;
      }
      fresh = Math.min(need, Math.max(0, delivered - n * need)) - 1;
      if (got.length) {
        fresh = -1;
        say(`Pedido entregue: cartão completo! Prêmio ${got.join(', ')}.`, 'gift');
      } else say(`Pedido entregue: ${stamps}º selo.`, 'ok');
    } else if (e === 'cancelled') {
      fresh = -1;
      say('Pedido cancelado: sem selo. Só pedido entregue conta.', 'no');
    } else if (e === 'refunded') {
      if (!delivered) return;
      delivered--;
      fresh = -1;
      say('Pedido entregue e depois estornado: o selo dele sai do cartão.', 'no');
    } else if (e === 'days') {
      rewards = rewards.map((r) =>
        r.state === 'open'
          ? { ...r, left: Math.max(0, r.left - 15), state: r.left - 15 <= 0 ? 'expired' : 'open' }
          : r,
      );
      fresh = -1;
      say('Passaram 15 dias.', 'no');
    }
  }

  function use(code: string) {
    rewards = rewards.map((r) => (r.code === code ? { ...r, state: 'used' } : r));
    say(`${code} usado no pedido. Uso único: ele sai do cartão.`, 'gift');
  }

  // the stamps' tilt: fixed per position, so a stamp never changes angle once it's down
  const tilt = (i: number) => ((i * 37) % 23) - 11;
</script>

<figure class="selos" aria-labelledby="selos-cap">
  <div class="setup">
    <div class="field">
      <label for="se-need">Selos para ganhar <output>{need}</output></label>
      <input
        id="se-need"
        type="range"
        min="2"
        max="50"
        bind:value={need}
        aria-valuetext="{need} selos"
      />
    </div>
    <div class="chips" role="radiogroup" aria-label="Prêmio">
      <label class="chip"
        ><input type="radio" name="se-kind" value="fixed" bind:group={kind} /><span
          >{brl(1500)}</span
        ></label
      >
      <label class="chip"
        ><input type="radio" name="se-kind" value="percent" bind:group={kind} /><span>10%</span
        ></label
      >
      <label class="chip"
        ><input type="radio" name="se-kind" value="free_delivery" bind:group={kind} /><span
          >Zera a entrega</span
        ></label
      >
    </div>
  </div>

  <div class="card" aria-live="polite">
    <div class="card-head">
      <p class="store">Bolos da Nena</p>
      <p class="whose">Cartão fidelidade da Bia</p>
    </div>
    <p class="rule">
      A cada {need} pedidos entregues: {label}.
    </p>
    <ol class="stamps" aria-label="{stamps} de {need} selos">
      {#each { length: need } as _, i (i)}
        <li
          class:on={i < stamps}
          class:fresh={!reduced && i === fresh}
          style="--tilt: {tilt(i)}deg"
          aria-hidden="true"
        >
          {i < stamps ? '★' : i + 1}
        </li>
      {/each}
    </ol>
    <p class="left">
      {stamps} de {need} selos. Faltam {need - stamps} para ganhar o prêmio.
    </p>
  </div>

  <div class="actions" role="group" aria-label="Simular pedidos da Bia">
    <button type="button" class="act ok" onclick={() => act('delivered')}>Pedido entregue</button>
    <button type="button" class="act" onclick={() => act('cancelled')}>Pedido cancelado</button>
    <button type="button" class="act" disabled={!delivered} onclick={() => act('refunded')}
      >Estornar um entregue</button
    >
    <button type="button" class="act" disabled={!open.length} onclick={() => act('days')}
      >Passar 15 dias</button
    >
  </div>

  {#if rewards.length}
    <ul class="rewards">
      {#each rewards as r (r.code)}
        <li class="reward">
          <Ticket
            big={r.kind === 'percent' ? '10%' : r.kind === 'fixed' ? brl(1500) : 'Entrega'}
            small={r.kind === 'free_delivery' ? 'zerada no pedido' : 'de desconto'}
            code={r.code}
            codeLabel="só da Bia"
            lines={r.state === 'open'
              ? ['uso único', r.left === 1 ? 'vence amanhã' : `vence em ${r.left} dias`]
              : []}
            off={r.state === 'used' ? 'Usado' : r.state === 'expired' ? 'Venceu' : null}
          />
          {#if r.state === 'open'}
            <button type="button" class="use" onclick={() => use(r.code)}
              >Usar no próximo pedido</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="none">
      Quando o cartão completar, o prêmio aparece aqui: um cupom com o código FIEL, que só vale para
      o telefone da Bia.
    </p>
  {/if}

  <ol class="log" aria-label="O que aconteceu">
    {#each log as l (l.id)}
      <li data-tone={l.tone}>{l.text}</li>
    {/each}
  </ol>

  <figcaption id="selos-cap">
    Simulação com a Bolos da Nena e uma cliente de exemplo, com as regras reais do cartão
    fidelidade: selo só para pedido entregue, prêmio pessoal de uso único, válido por 60 dias.
  </figcaption>
</figure>

<style>
  figure.selos {
    --paper: var(--surface-sunken);
    display: grid;
    gap: 16px;
    margin: 12px 0;
    padding: 20px 16px;
    border-radius: var(--radius-lg);
    background: var(--paper);
  }
  @media (min-width: 480px) {
    figure.selos {
      padding: 24px;
    }
  }

  .setup {
    display: grid;
    gap: 10px;
  }
  .field {
    display: grid;
    gap: 2px;
  }
  .field label {
    display: flex;
    justify-content: space-between;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
  }
  .field output {
    font-variant-numeric: tabular-nums;
  }
  input[type='range'] {
    width: 100%;
    min-height: 44px;
    margin: 0;
    accent-color: var(--primary);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    position: relative;
    display: flex;
  }
  .chip input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .chip span {
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 0 14px;
    border: 1.5px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
  }
  .chip input:checked + span {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--on-primary);
  }
  .chip input:focus-visible + span {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  /* the card itself: a punch card in the shop's hand */
  .card {
    display: grid;
    gap: 12px;
    padding: 18px 16px 16px;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-e2);
    transform: rotate(-0.6deg);
  }
  .card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 2px 12px;
    padding-bottom: 10px;
    border-bottom: 2px dotted var(--line-strong);
  }
  figure.selos p.store {
    font: 600 1.25rem/1.2 var(--font-display);
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  figure.selos p.whose,
  figure.selos p.left {
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  figure.selos p.rule {
    font-size: 0.9375rem;
    line-height: 1.45;
    font-weight: 600;
    color: var(--ink);
  }
  ol.stamps {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  @media (min-width: 480px) {
    ol.stamps {
      grid-template-columns: repeat(10, minmax(0, 1fr));
    }
  }
  ol.stamps li {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    max-width: 48px;
    width: 100%;
    justify-self: center;
    border: 2px dashed var(--line-strong);
    border-radius: 50%;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  ol.stamps li.on {
    border: 2px solid var(--primary);
    background: var(--primary);
    color: var(--on-primary);
    font-size: 1.125rem;
    transform: rotate(var(--tilt));
    box-shadow: inset 0 0 0 3px var(--surface);
  }
  ol.stamps li.fresh {
    animation: stamp 260ms var(--ease-soft);
  }
  @keyframes stamp {
    from {
      transform: scale(1.5) rotate(0deg);
      opacity: 0;
    }
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  button.act,
  button.use {
    min-height: 44px;
    padding: 6px 12px;
    border: 1.5px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    font: 600 0.9375rem/1.2 var(--font-sans);
    cursor: pointer;
  }
  button.act.ok {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--on-primary);
  }
  button.act:disabled {
    color: var(--ink-faint);
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  ul.rewards {
    display: grid;
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li.reward {
    display: grid;
    gap: 8px;
    padding-inline: 4px;
  }
  button.use {
    justify-self: start;
  }
  figure.selos p.none {
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }

  ol.log {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 12px 0 0;
    border-top: 1px solid var(--line-strong);
    list-style: none;
  }
  ol.log li {
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  ol.log li:first-child {
    color: var(--ink);
    font-weight: 600;
  }
  ol.log li[data-tone='gift']:first-child {
    color: var(--success);
  }
  figure.selos figcaption {
    max-width: none;
    text-align: left;
  }
  @media (prefers-reduced-motion: reduce) {
    ol.stamps li.fresh {
      animation: none;
    }
  }
</style>
