<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import Dua, { type Pose } from '$lib/components/Dua.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import { clock } from '../clock';
  import Store from './Store.svelte';
  import {
    ACCENTS,
    CATS,
    DONE,
    EMPTY,
    HOWS,
    NAME,
    STEPS,
    URL,
    type Accent,
    type Cat,
    type How,
    type Shop,
    type StepId,
  } from './script';

  // The admin's onboarding in miniature: Duá asks one question at a time, the visitor answers with a
  // chip, and the store beside it fills in. Still (no JS) it is the finished store and Duá's last line.
  let { live, reduced }: { live: boolean; reduced: boolean } = $props();

  const POSE: Record<StepId, Pose> = {
    nome: 'loja',
    cores: 'personalizar',
    como: 'entrega',
    produtos: 'catalogo',
    pronto: 'publicar',
  };

  let step = $state<StepId>('pronto');
  let praise = $state<string | null>('Cardápio no ar!');
  let typing = $state(false);
  let shop = $state<Shop>({ ...DONE, cats: [...DONE.cats] });

  const c = clock(() => reduced);
  onDestroy(c.stop);

  $effect(() => {
    if (!live) return;
    untrack(() => {
      step = 'nome';
      praise = 'Oi, Nena! Meu nome é Duá.';
      shop = { ...EMPTY, cats: [] };
    });
  });

  // Duá "types" for a beat before each new question, like the admin's Guide
  async function ask(next: StepId, said: string) {
    praise = said;
    step = next;
    typing = true;
    await c.wait(560);
    typing = false;
  }

  const name = () => {
    shop.named = true;
    void ask('cores', `${NAME}… que nome bonito!`);
  };
  const color = (a: Accent) => (shop.accent = a);
  const how = (h: How, said: string) => {
    shop.how = h;
    void ask('produtos', said);
  };
  const toggle = (id: Cat) =>
    (shop.cats = shop.cats.includes(id) ? shop.cats.filter((x) => x !== id) : [...shop.cats, id]);

  const s = $derived(STEPS[step]);
  const t = $derived(reduced ? 0 : 240);
</script>

<div class="box">
  <div class="loja" class:still={reduced}>
    <div class="guide">
      <div class="turn">
        <span class="disc" aria-hidden="true">
          {#key step}
            <Dua pose={POSE[step]} size={68} eager={step === 'pronto'} />
          {/key}
        </span>
        <div class="said" aria-live="polite">
          {#if typing}
            <p class="bubble" aria-hidden="true">
              <span class="bars"><span></span><span></span></span>
            </p>
          {:else}
            <p class="bubble" in:fly={{ y: 4, duration: t }}>
              {#if praise}<strong>{praise}</strong>{/if}
              {s.line}
            </p>
            <p class="q" class:big={step === 'pronto'} in:fly={{ y: 4, duration: t }}>
              {s.question}
            </p>
          {/if}
        </div>
      </div>

      <div class="ask" class:wait={typing}>
        {#if s.hint}<p class="hint">{s.hint}</p>{/if}

        {#if step === 'pronto'}
          <p class="addr">{URL}</p>
        {:else if live}
          <div class="answers">
            {#if step === 'nome'}
              <div class="chips">
                <button type="button" class="chip" disabled={typing} onclick={name}>{NAME}</button>
              </div>
            {:else if step === 'cores'}
              <div class="chips" role="group" aria-label="cores">
                {#each ACCENTS as a (a.id)}
                  <button
                    type="button"
                    class="chip"
                    aria-pressed={shop.accent === a.id}
                    disabled={typing}
                    onclick={() => color(a.id)}
                  >
                    <span class="dot loja-acc-{a.id}" aria-hidden="true"></span>{a.label}
                  </button>
                {/each}
              </div>
              <button
                type="button"
                class="go"
                disabled={typing || !shop.accent}
                onclick={() => void ask('como', 'Que combinação!')}>Continuar</button
              >
            {:else if step === 'como'}
              <div class="chips">
                {#each HOWS as h (h.id)}
                  <button
                    type="button"
                    class="chip"
                    disabled={typing}
                    onclick={() => how(h.id, h.praise)}>{h.label}</button
                  >
                {/each}
              </div>
            {:else if step === 'produtos'}
              <div class="chips" role="group" aria-label="o que entra no cardápio">
                {#each CATS as k (k.id)}
                  <button
                    type="button"
                    class="chip"
                    aria-pressed={shop.cats.includes(k.id)}
                    disabled={typing}
                    onclick={() => toggle(k.id)}>{k.label}</button
                  >
                {/each}
              </div>
              <button
                type="button"
                class="go"
                disabled={typing || !shop.cats.length}
                onclick={() => void ask('pronto', 'Cardápio no ar!')}>Terminei</button
              >
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <div class="device">
      <Phone width={320} label="A loja Bolos da Nena, como o cliente vê no celular">
        <Store {shop} {reduced} />
      </Phone>
    </div>
  </div>
</div>

<style>
  /* The frame around it shrinks to fit its content, so no container query here (a container has
     no intrinsic width): the guide and the phone wrap onto two rows when they don't fit side by side. */
  .box {
    max-width: 660px;
    text-align: start;
  }
  .loja {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 20px 32px;
  }
  .guide {
    flex: 1 1 250px;
    max-width: 420px;
    min-height: 290px;
    display: grid;
    align-content: start;
    gap: 14px;
  }
  .turn {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .disc {
    flex: none;
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: var(--radius-md);
    background: var(--spark-soft);
    overflow: hidden;
  }
  .disc :global(.dua) {
    width: 50px;
  }
  .said {
    min-width: 0;
    flex: 1;
    display: grid;
    gap: 10px;
  }
  .bubble {
    margin: 0;
    min-height: 48px;
    padding: 10px 14px;
    border-radius: var(--radius-md) var(--radius-md) var(--radius-md) 4px;
    background: var(--surface);
    box-shadow: var(--shadow-e1);
    color: var(--ink);
  }
  .bubble strong {
    margin-right: 4px;
  }
  .bars {
    display: grid;
    gap: 8px;
    padding: 4px 0;
  }
  .bars span {
    display: block;
    height: 10px;
    border-radius: 999px;
    background: var(--surface-sunken);
  }
  .bars span + span {
    width: 60%;
  }
  .q {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.25rem;
    line-height: 1.25;
    color: var(--ink);
  }
  .q.big {
    font-size: 1.6rem;
  }
  .ask {
    display: grid;
    gap: 12px;
    transition: opacity var(--duration-quick) var(--ease-soft);
  }
  .ask.wait {
    opacity: 0;
  }
  .still .ask {
    transition: none;
  }
  .hint {
    margin: 0;
    color: var(--ink-muted);
    font-size: 0.9375rem;
  }
  /* the chips and the button share one row of chips (fewer lines, so the phone below moves less) */
  .answers {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chips {
    display: contents;
  }
  .chip,
  .go {
    min-height: 44px;
    padding: 0 16px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--duration-quick) var(--ease-soft),
      box-shadow var(--duration-quick) var(--ease-soft);
  }
  .chip:hover {
    background: var(--hover);
  }
  .chip[aria-pressed='true'] {
    border-color: var(--primary);
    box-shadow: inset 0 0 0 1px var(--primary);
    background: var(--spark-soft);
  }
  .go {
    border-color: transparent;
    background: var(--primary);
    color: var(--on-primary);
  }
  .go:hover:not(:disabled) {
    background: var(--primary-hover);
  }
  .go:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .chip:focus-visible,
  .go:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .dot {
    width: 20px;
    height: 20px;
    margin-left: -6px;
    border-radius: 50%;
    background: var(--acc);
    box-shadow: 0 0 0 2px var(--surface);
  }
  .addr {
    justify-self: start;
    margin: 0;
    padding: 10px 16px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow-e1);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .ask {
    padding-left: 64px;
  }
  .device {
    flex: none;
    width: 270px;
    max-width: 100%;
  }
  @media (min-width: 560px) {
    .disc {
      width: 64px;
      height: 64px;
    }
    .disc :global(.dua) {
      width: 62px;
    }
    .ask {
      padding-left: 76px;
    }
  }
  @media (max-width: 559px) {
    .device {
      width: 228px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ask,
    .chip,
    .go {
      transition: none;
    }
  }
</style>
