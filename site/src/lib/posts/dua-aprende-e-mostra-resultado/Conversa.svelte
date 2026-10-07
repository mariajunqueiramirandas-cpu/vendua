<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { clock } from '$lib/demos/clock';
  import { brl } from './money';
  import { lineWord, modeWord, payWord, score, type Scenario } from './oculto';

  // One test shopper's conversation, then the hidden order next to what Duá closed, then the grade.
  // `play` replays the talk at reading pace (instant with reduced motion); without it, all of it.
  let { sc, play, reduced }: { sc: Scenario; play: boolean; reduced: boolean } = $props();

  const t = clock(() => reduced);
  onDestroy(() => t.stop());
  let shown = $state(untrack(() => (play ? 0 : sc.talk.length)));
  const done = $derived(shown >= sc.talk.length);
  const s = $derived(score(sc));

  $effect(() => {
    if (!untrack(() => play)) return;
    (async () => {
      for (let i = 0; i < sc.talk.length; i++) {
        await t.wait(i === 0 ? 150 : sc.talk[i - 1]!.who === 'julia' ? 650 : 500);
        shown = i + 1;
      }
    })();
  });
</script>

<div class="conv">
  <p class="who">
    Júlia, cliente de teste: {sc.tone}.
  </p>
  <ol class="talk" aria-label="Conversa de teste">
    {#each sc.talk.slice(0, shown) as m, i (i)}
      {#if m.who === 'card'}
        <li class="card">
          {#each m.lines as l (l.text)}
            <span class="ln"><span>{l.text}</span><span class="tnum">{brl(l.cents)}</span></span>
          {/each}
          {#if m.feeCents}
            <span class="ln"><span>Entrega</span><span class="tnum">{brl(m.feeCents)}</span></span>
          {:else}
            <span class="ln"><span>Retirada na loja</span><span></span></span>
          {/if}
          <span class="ln tot"
            ><span>Total</span><span class="tnum"
              >{brl(m.lines.reduce((n, l) => n + l.cents, 0) + m.feeCents)}</span
            ></span
          >
          <span class="foot">{m.payment}, calculado pela loja. Posso fechar?</span>
        </li>
      {:else if m.who === 'note'}
        <li class="note">{m.text}</li>
      {:else}
        <li class={m.who}>
          <span class="sr">{m.who === 'julia' ? 'Júlia' : 'Duá'}:</span>
          {m.text}
        </li>
      {/if}
    {/each}
  </ol>

  {#if done}
    {#if sc.target}
      <div class="key">
        <div class="slip hidden">
          <p class="k">Pedido escondido</p>
          {#each sc.target.lines as l (l.name)}<p class="l">{lineWord(l)}</p>{/each}
          <p class="m">{modeWord(sc.target.mode)}, {payWord(sc.target.payment)}</p>
          <p class="hint">A Júlia sabe, o Duá não.</p>
        </div>
        <div class="slip">
          <p class="k">O Duá fechou</p>
          {#if sc.closed}
            {#each sc.closed.lines as l (l.name)}<p class="l">{lineWord(l)}</p>{/each}
            <p class="m">{modeWord(sc.closed.mode)}, {payWord(sc.closed.payment)}</p>
          {:else}
            <p class="l">nenhum pedido</p>
          {/if}
        </div>
      </div>
    {/if}
    <p class="grade" class:ok={s.passed}>
      <span class="mark" aria-hidden="true">{s.passed ? '✓' : '✗'}</span>
      <span><strong>{s.passed ? 'Certo' : 'Errou'}:</strong> {s.why}.</span>
    </p>
  {/if}
</div>

<style>
  .conv {
    display: grid;
    gap: 12px;
    padding: 14px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    min-width: 0;
  }
  .conv p {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink);
  }
  .conv p.who {
    color: var(--ink-muted);
  }
  .conv ol {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .conv li {
    max-width: 85%;
    padding: 8px 12px;
    border-radius: 14px;
    font-size: 0.9375rem;
    line-height: 1.4;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .conv li.julia {
    justify-self: end;
    border-bottom-right-radius: 4px;
    background: var(--success-soft);
  }
  .conv li.dua {
    justify-self: start;
    border-bottom-left-radius: 4px;
    background: var(--surface);
    box-shadow: var(--shadow-e1);
  }
  .conv li.card {
    justify-self: start;
    display: grid;
    gap: 4px;
    width: min(100%, 22rem);
    max-width: 100%;
    background: var(--surface);
    box-shadow:
      var(--shadow-e1),
      inset 3px 0 0 var(--primary);
    font-size: 0.875rem;
  }
  .ln {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .ln > :last-child {
    flex: none;
    white-space: nowrap;
  }
  .ln.tot {
    padding-top: 4px;
    border-top: 1px solid var(--line);
    font-weight: 650;
  }
  .foot {
    color: var(--ink-muted);
    font-size: 0.8125rem;
  }
  .conv li.note {
    justify-self: center;
    max-width: 100%;
    padding: 4px 10px;
    background: transparent;
    font-size: 0.8125rem;
    color: var(--ink-muted);
    text-align: center;
  }
  .key {
    display: grid;
    gap: 10px;
  }
  @media (min-width: 520px) {
    .key {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .slip {
    display: grid;
    align-content: start;
    gap: 2px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .slip.hidden {
    background: var(--warning-soft);
    box-shadow: none;
    outline: 1.5px dashed color-mix(in srgb, var(--warning) 60%, transparent);
    outline-offset: -5px;
  }
  .conv p.k {
    font-weight: 650;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .conv p.l {
    font-weight: 600;
  }
  .conv p.m,
  .conv p.hint {
    color: var(--ink-muted);
    font-size: 0.8125rem;
  }
  .conv p.grade {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--warning-soft);
    font-size: 0.9375rem;
  }
  .conv p.grade.ok {
    background: var(--success-soft);
  }
  .mark {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    border-radius: 50%;
    background: var(--warning);
    color: var(--surface);
    font-weight: 700;
    font-size: 0.875rem;
  }
  .grade.ok .mark {
    background: var(--success);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
