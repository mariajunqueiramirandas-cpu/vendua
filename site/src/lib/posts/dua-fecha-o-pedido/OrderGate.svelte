<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { clock } from '$lib/demos/clock';
  import Fita from './Fita.svelte';
  import Thread from './Thread.svelte';
  import { answer, finished, replies, start, type State } from './flow';

  // The gate made visible: the visitor answers for Bia, the store's ledger redoes the sums, and an
  // order only happens on a yes to the latest summary (readAnswer, ported in gate.ts). Without
  // `live` it is the finished story: one change, a new summary, then the yes.
  let { live, reduced }: { live: boolean; reduced: boolean } = $props();
  const still = untrack(() => !live);

  const s: State = $state(still ? finished() : start());
  let typing = $state(false);
  let draft = $state(false);
  let typed = $state('');
  let busy = $state(false);
  let chipsEl: HTMLDivElement | undefined = $state();

  const t = clock(() => reduced);
  onDestroy(() => t.stop());

  const options = $derived(replies(s));

  async function send(id: string, text?: string) {
    if (busy || s.placed) return;
    busy = true;
    const hadFocus = !!chipsEl?.contains(document.activeElement);
    const [me, ...rest] = answer(s, id, text);
    s.msgs.push(me!);
    await t.wait(350);
    for (const m of rest) {
      typing = true;
      await t.wait(m.kind === 'dua' ? 700 : 450);
      typing = false;
      s.msgs.push(m);
    }
    busy = false;
    if (hadFocus && !s.placed) {
      await tick();
      chipsEl?.querySelector('button')?.focus({ preventScroll: true });
    }
  }

  function submit(e: Event) {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    typed = '';
    void send('typed', text);
  }
</script>

<div class="gate-w">
  <div class="top">
    <button
      type="button"
      class="toggle"
      aria-pressed={draft}
      onclick={() => (draft = !draft)}
      disabled={!live}
    >
      <span class="knob" aria-hidden="true"></span>
      Ver o rascunho do Duá
    </button>
    <p class="hint">
      {draft
        ? 'Os buracos são os números: quem preenche é a conta da loja.'
        : 'Valores sublinhados vêm da conta da loja.'}
    </p>
  </div>

  <div class="stage">
    <div class="chat">
      <Thread msgs={s.msgs} {typing} {draft} anim={live && !reduced} placed={s.placed} />
    </div>
    <Fita {s} />
  </div>

  {#if live && !s.placed}
    <div class="answer">
      <p class="who" id="bia-responde">A Bia responde:</p>
      <div
        class="chips"
        role="group"
        aria-labelledby="bia-responde"
        tabindex="-1"
        bind:this={chipsEl}
      >
        {#each options as r (r.id)}
          <button type="button" disabled={busy} onclick={() => send(r.id)}>{r.text}</button>
        {/each}
      </div>
      <div class="type" role="group" aria-label="Escrever a resposta">
        <label for="bia-escreve">Ou escreva como ela</label>
        <span class="row">
          <input
            id="bia-escreve"
            type="text"
            maxlength="80"
            autocomplete="off"
            placeholder="pode fechar"
            bind:value={typed}
            onkeydown={(e) => e.key === 'Enter' && submit(e)}
          />
          <button type="button" disabled={busy || !typed.trim()} onclick={submit}>enviar</button>
        </span>
      </div>
    </div>
  {/if}
</div>

<style>
  .gate-w {
    container: gate / inline-size;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    min-width: 0;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
  }
  div.gate-w p {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 16px 0 8px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.9375rem/1 var(--font-sans);
    cursor: pointer;
  }
  .toggle:disabled {
    cursor: default;
  }
  .knob {
    position: relative;
    width: 38px;
    height: 24px;
    border-radius: 999px;
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .knob::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--ink-muted);
    transition: transform var(--duration-quick) var(--ease-soft);
  }
  .toggle[aria-pressed='true'] .knob {
    background: var(--primary);
  }
  .toggle[aria-pressed='true'] .knob::after {
    transform: translateX(14px);
    background: var(--on-primary);
  }
  .stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  .chat {
    height: 470px;
    min-width: 0;
  }
  @container gate (min-width: 560px) {
    .stage {
      grid-template-columns: minmax(0, 1fr) 200px;
      align-items: start;
    }
    .chat {
      height: 540px;
    }
  }
  .answer {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    gap: 8px;
    padding: 14px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }
  .gate-w .who {
    font-weight: 650;
    color: var(--ink);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    outline: none;
  }
  .chips button,
  .type button {
    max-width: 100%;
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.9375rem/1.2 var(--font-sans);
    cursor: pointer;
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .chips button:hover:not(:disabled),
  .toggle:hover:not(:disabled) {
    background: color-mix(in srgb, var(--spark-soft) 60%, var(--surface));
  }
  .chips button:disabled,
  .type button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .type {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    margin-top: 4px;
  }
  .type label {
    font-size: 0.875rem;
    color: var(--ink-muted);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .type input {
    flex: 1 1 0;
    width: 0;
    min-width: 0;
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 400 1rem/1.2 var(--font-sans);
  }
  .type input::placeholder {
    color: var(--ink-muted);
  }
  .type button {
    background: var(--primary);
    color: var(--on-primary);
    border-color: transparent;
  }
  .chips button:focus-visible,
  .type button:focus-visible,
  .type input:focus-visible,
  .toggle:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .knob,
    .knob::after,
    .chips button {
      transition: none;
    }
  }
</style>
