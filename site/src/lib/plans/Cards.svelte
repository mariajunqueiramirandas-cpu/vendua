<script lang="ts">
  import Dua from '$lib/components/Dua.svelte';
  import { plans, signup } from '$lib/content';

  const { mirim, bandeira, pangolim } = plans;

  // a perk with a live demo links to it in the hub (`#demo-<id>`, Demos.svelte)
  type Perk = { text: string; demo?: 'vendedor' | 'pedido' | 'cozinha' | 'loja'; see?: string };
  const perks: Record<'mirim' | 'bandeira' | 'pangolim', Perk[]> = {
    mirim: [
      { text: 'A loja com o seu nome', demo: 'loja', see: 'a loja' },
      { text: 'Pedidos no celular', demo: 'pedido', see: 'um pedido chegando' },
      { text: 'Cardápio, Pix, entrega, cupons e relatórios' },
    ],
    bandeira: [
      { text: 'Tela da cozinha', demo: 'cozinha', see: 'a tela da cozinha' },
      { text: 'Impressão automática da comanda' },
      { text: 'Cartão fidelidade' },
      {
        text: `Duá, vendedor com IA no WhatsApp da loja: ${bandeira.conversations} conversas por mês (${bandeira.trialConversations} no teste)`,
        demo: 'vendedor',
        see: 'o Duá',
      },
    ],
    pangolim: [
      { text: 'Domínio próprio' },
      { text: 'Um site feito pelo nosso agente de IA' },
      {
        text: `Duá com ${pangolim.conversations} conversas por mês`,
        demo: 'vendedor',
        see: 'o Duá',
      },
    ],
  };
</script>

{#snippet list(items: Perk[])}
  <ul class="perks" role="list">
    {#each items as p (p.text)}
      <li>
        {p.text}{#if p.demo}
          <a class="see" href="#demo-{p.demo}" aria-label="Veja {p.see} funcionando"
            ><i aria-hidden="true"></i>veja</a
          >{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<!-- Mirim plain on the sky, Bandeira raised in the middle with Duá's flag, Pangolim on the night sky -->
<ul class="plans" role="list">
  <li class="plan mirim">
    <div class="row">
      <h3 class="name">{mirim.name}</h3>
      <p class="cost tnum">{mirim.price}<small>/mês</small></p>
    </div>
    <p class="addr"><span class="lock" aria-hidden="true"></span>seunome.vendua.com.br</p>
    {@render list(perks.mirim)}
    <p class="lacks">Sem a tela da cozinha, a impressão, o cartão fidelidade e o Duá.</p>
    <a class="take" href={signup(mirim.id)}
      >Criar loja no {mirim.short}<i class="go" aria-hidden="true"></i></a
    >
  </li>

  <li class="plan bandeira">
    <Dua pose="publicar" size={128} class="flag" />
    <p class="rec">Recomendado</p>
    <h3 class="name">{bandeira.name}</h3>
    <p class="promise">Do WhatsApp à cozinha, num plano só.</p>
    <p class="cost tnum">
      <strong>{bandeira.price}<small>/mês</small></strong>
      <span class="trial">começa com {bandeira.trial}, sem cartão</span>
    </p>
    <p class="more">Tudo do {mirim.short}, e mais:</p>
    {@render list(perks.bandeira)}
    <a class="take main" href={signup(bandeira.id)}
      >Criar loja no {bandeira.short}<i class="go" aria-hidden="true"></i></a
    >
  </li>

  <li class="plan pangolim">
    <div class="row">
      <h3 class="name">{pangolim.name}</h3>
      <p class="cost tnum">{pangolim.price}<small>/mês</small></p>
    </div>
    <p class="addr"><span class="lock" aria-hidden="true"></span>bolosdanena.com.br</p>
    <p class="more">Tudo do {bandeira.short}, e mais:</p>
    {@render list(perks.pangolim)}
    {#if pangolim.available}
      <a class="take" href={signup(pangolim.id)}
        >Criar loja no {pangolim.short}<i class="go" aria-hidden="true"></i></a
      >
    {:else}
      <p class="closed">Ainda não está aberto para assinatura.</p>
    {/if}
  </li>
</ul>

<style>
  .plans {
    list-style: none;
    display: grid;
    gap: 16px;
    width: min(100%, 520px);
    justify-self: center;
    margin: 0;
    padding: 0;
  }
  @media (min-width: 1024px) {
    .plans {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr);
      align-items: start;
      gap: 0;
      width: 100%;
    }
  }
  .plan {
    position: relative;
    display: grid;
    justify-items: start;
    align-content: start;
    gap: 8px;
    min-width: 0;
    padding: 22px 20px;
  }
  /* Mirim and Pangolim: name and price on one line, so Bandeira's price is the one that stands out */
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 2px 12px;
    width: 100%;
  }
  .name {
    margin: 0;
    font: 600 1.0625rem/1.3 var(--font-display);
    letter-spacing: -0.01em;
  }
  .cost {
    font: 700 1.625rem/1.1 var(--font-display);
    letter-spacing: -0.02em;
  }
  .cost small {
    font-size: 0.875rem;
    font-weight: 600;
    letter-spacing: 0;
  }
  .lacks,
  .more {
    max-width: 38ch;
    font-size: 0.9375rem;
    line-height: 1.45;
  }
  .lacks {
    color: var(--ink-muted);
    font-size: 0.875rem;
  }
  .more {
    margin-top: 2px;
    font-weight: 600;
  }

  /* the address: Mirim's on vendua.com.br, Pangolim's on its own domain */
  .addr {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    margin: 2px 0;
    padding: 6px 12px 6px 11px;
    border-radius: 999px;
    background: var(--spark-soft);
    color: var(--ink);
    font: 600 0.875rem/1.2 var(--font-display);
    white-space: nowrap;
  }
  .lock {
    position: relative;
    flex: none;
    width: 10px;
    height: 8px;
    margin-top: 4px;
    border-radius: 2px;
    background: currentColor;
  }
  .lock::before {
    content: '';
    position: absolute;
    left: 1.5px;
    bottom: 6px;
    width: 7px;
    height: 6px;
    border: 1.8px solid currentColor;
    border-bottom: 0;
    border-radius: 4px 4px 0 0;
    box-sizing: border-box;
  }

  .perks {
    list-style: none;
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    font-size: 0.9375rem;
    line-height: 1.45;
  }
  .perks li {
    position: relative;
    padding-left: 24px;
  }
  /* a drawn tick, the same stroke as the arrows */
  .perks li::before {
    content: '';
    position: absolute;
    left: 3px;
    top: 0.32em;
    width: 6px;
    height: 11px;
    border: solid var(--tick, var(--success));
    border-width: 0 2px 2px 0;
    border-radius: 1px;
    rotate: 40deg;
  }
  /* "veja": a small chip after the perk; its hit area grows to 44 px without moving the lines */
  .see {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-left: 6px;
    padding: 2px 9px 3px 8px;
    border-radius: 999px;
    background: var(--hover);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: inherit;
    font: 600 0.8125rem/1.2 var(--font-sans);
    text-decoration: none;
    white-space: nowrap;
    vertical-align: 1px;
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .see::after {
    content: '';
    position: absolute;
    inset: -12px -4px;
  }
  .see i {
    width: 0;
    height: 0;
    border-block: 4px solid transparent;
    border-left: 6px solid currentColor;
  }
  .see:hover {
    background: var(--spark);
    color: var(--on-spark);
    box-shadow: none;
  }

  .take {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    margin-top: 8px;
    padding: 0 16px;
    border-radius: var(--radius-md);
    box-shadow: inset 0 0 0 1.5px currentColor;
    color: inherit;
    font: 600 0.9375rem/1 var(--font-sans);
    text-decoration: none;
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .take:hover {
    background: var(--hover);
  }
  .go {
    position: relative;
    flex: none;
    width: 12px;
    height: 2px;
    border-radius: 2px;
    background: currentColor;
    transition: translate var(--duration-quick) var(--ease-soft);
  }
  .go::after {
    content: '';
    position: absolute;
    right: -1px;
    top: -3px;
    width: 7px;
    height: 7px;
    border: solid currentColor;
    border-width: 2px 2px 0 0;
    border-radius: 1px;
    rotate: 45deg;
  }
  .take:hover .go {
    translate: 3px 0;
  }

  /* Mirim: no card, just the facts on the sky */
  .mirim {
    padding-inline: 0;
    border-top: 2px dashed var(--line-strong);
  }
  .mirim .perks li::before {
    border-color: var(--ink-faint);
  }
  @media (min-width: 1024px) {
    .mirim {
      margin-top: 44px;
      padding: 24px 32px 8px 0;
    }
  }

  /* Bandeira: the one to pick, with Duá raising the flag over its edge */
  .bandeira {
    gap: 10px;
    padding: 30px 22px 24px;
    border-radius: var(--radius-xl);
    background: var(--surface-raised);
    box-shadow:
      0 0 0 2px var(--primary),
      var(--shadow-e3);
    z-index: 1;
  }
  @media (min-width: 1024px) {
    .bandeira {
      padding: 38px 32px 30px;
    }
  }
  .bandeira :global(.flag) {
    position: absolute;
    top: -62px;
    right: 6px;
    width: 104px;
    pointer-events: none;
    filter: drop-shadow(0 8px 10px rgb(18 60 50 / 0.16));
  }
  @media (min-width: 1024px) {
    .bandeira :global(.flag) {
      top: -84px;
      right: 14px;
      width: 128px;
    }
  }
  .rec {
    position: absolute;
    top: -14px;
    left: 20px;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--spark);
    color: var(--on-spark);
    font: 700 0.875rem/1 var(--font-display);
    rotate: -2deg;
    box-shadow: var(--shadow-e1);
  }
  .bandeira .name {
    font-size: 1.25rem;
    padding-right: 72px;
  }
  .promise {
    max-width: 32ch;
    margin-top: -4px;
    font: 500 clamp(1rem, 0.9rem + 0.4vw, 1.0625rem) / 1.35 var(--font-display);
    letter-spacing: -0.01em;
    color: color-mix(in srgb, var(--ink) 60%, var(--ink-muted));
  }
  .bandeira .cost {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    margin-block: 4px 2px;
  }
  .bandeira .cost strong {
    display: inline-block;
    padding: 6px 12px 7px;
    border-radius: 10px;
    background: var(--spark);
    color: var(--on-spark);
    font-size: clamp(2.25rem, 6vw, 2.75rem);
  }
  .bandeira .cost small {
    font-size: 1rem;
  }
  .trial {
    flex: 1 1 0;
    min-width: 11ch;
    max-width: 16ch;
    font: 600 0.875rem/1.3 var(--font-display);
    letter-spacing: 0;
    color: var(--success);
  }
  .take.main {
    justify-content: center;
    width: 100%;
    min-height: 52px;
    margin-top: 12px;
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: var(--shadow-e1);
    font-size: 1rem;
  }
  .take.main:hover {
    background: var(--primary-hover);
  }

  /* Pangolim: the top of the line, under the night sky in both themes */
  .pangolim {
    --tick: var(--spark);
    border-radius: var(--radius-lg);
    background: var(--sky-5);
    color: var(--after-ink);
    box-shadow: 0 0 0 1px var(--after-line);
  }
  .pangolim .addr {
    background: var(--spark);
    color: var(--on-spark);
  }
  .pangolim .see {
    background: var(--after-card);
    box-shadow: inset 0 0 0 1px var(--after-line);
  }
  .pangolim .see:hover {
    background: var(--spark);
    color: var(--on-spark);
  }
  .pangolim .take:hover {
    background: var(--after-card);
  }
  /* closed (content.ts `available`): a plain line where the button would be, nothing to press */
  .closed {
    width: 100%;
    margin-top: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--after-line);
    color: var(--after-muted);
    font: 500 0.9375rem/1.4 var(--font-sans);
  }
  @media (min-width: 1024px) {
    .pangolim {
      margin: 44px 0 0 20px;
      padding: 26px 24px;
    }
  }

  @media (prefers-color-scheme: dark) {
    .bandeira :global(.flag) {
      filter: drop-shadow(0 0 18px color-mix(in srgb, var(--spark) 18%, transparent))
        drop-shadow(0 8px 12px rgb(0 0 0 / 0.4));
    }
  }
  @media (max-width: 559px) {
    .plan {
      gap: 6px;
      padding: 18px 18px 20px;
    }
    .mirim {
      padding-inline: 0;
    }
    .bandeira {
      gap: 8px;
      padding: 28px 20px 20px;
    }
    .perks {
      gap: 4px;
    }
    .take.main {
      margin-top: 8px;
    }
  }
</style>
