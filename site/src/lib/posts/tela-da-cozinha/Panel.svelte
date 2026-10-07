<script lang="ts">
  import { onMount } from 'svelte';
  import { SPOTLIGHT_MS, reducedMotion } from './rules';
  import { play, speak } from './sound';

  // The pickup display (/cozinha/painel, after apps/admin/src/features/kitchen/Pickup.tsx): numbers
  // only, "preparando" on one side and "pronto" on the other; a number that turns ready takes the
  // whole screen for 7 s, one at a time, with the ding-dong and the call when sound is on.
  const first = { making: [38, 39, 40], ready: [37, 36] };
  let making = $state([...first.making]);
  let ready = $state([...first.ready]);
  let stage = $state<number | null>(null);
  let left = $state(0);
  let sound = $state(false);
  let live = $state(false);
  let reduced = $state(false);
  const line: number[] = [];
  let until = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    live = true;
    reduced = reducedMotion();
  });
  $effect(() => () => {
    clearTimeout(timer);
    clearInterval(beat);
  });

  function next() {
    clearInterval(beat);
    const n = line.shift();
    if (n === undefined) {
      stage = null;
      return;
    }
    stage = n;
    until = Date.now() + SPOTLIGHT_MS;
    left = SPOTLIGHT_MS / 1000;
    beat = setInterval(() => (left = Math.max(0, Math.ceil((until - Date.now()) / 1000))), 200);
    if (sound) {
      play('call');
      setTimeout(() => speak(`Pedido ${n}. Pronto para retirada!`), 900);
    }
    timer = setTimeout(next, SPOTLIGHT_MS);
  }

  function bump(n: number) {
    making = making.filter((x) => x !== n);
    ready = [n, ...ready].slice(0, 6);
    line.push(n);
    if (stage === null) next();
  }
  function reset() {
    clearTimeout(timer);
    clearInterval(beat);
    line.length = 0;
    stage = null;
    making = [...first.making];
    ready = [...first.ready];
  }
</script>

<figure class="pn-w" aria-label="O painel de retirada">
  <div class="tv">
    <div class="screen">
      <div class="top">
        <p class="store">Bolos da Nena</p>
        <p class="sub">Acompanhe seu pedido</p>
      </div>
      <div class="cols">
        <section class="col making" aria-label="preparando">
          <p class="h"><span class="dot" aria-hidden="true"></span>Preparando</p>
          {#if making.length}
            <ul>
              {#each making as n (n)}<li class="tnum">{n}</li>{/each}
            </ul>
          {:else}
            <p class="empty">Nenhum pedido no fogo agora.</p>
          {/if}
        </section>
        <section class="col done" aria-label="pronto, pode retirar">
          <p class="h"><span class="dot sq" aria-hidden="true"></span>Pronto, pode retirar</p>
          <ul>
            {#each ready as n, k (n)}<li class="tnum" class:latest={k === 0}>{n}</li>{/each}
          </ul>
        </section>
      </div>
      {#if stage !== null}
        <div class="stage" class:still={reduced} role="alert">
          <p class="call">Pronto para retirada</p>
          <p class="big tnum">{stage}</p>
          <p class="secs tnum" aria-hidden="true">{left} s</p>
          {#key stage}<span class="drain" class:still={reduced} aria-hidden="true"></span>{/key}
        </div>
      {/if}
    </div>
  </div>

  <div class="ctl">
    <p class="ask">Na cozinha, alguém marca pronto:</p>
    <div class="btns">
      {#each making as n (n)}
        <button type="button" class="b" disabled={!live} onclick={() => bump(n)}>#{n} pronto</button
        >
      {/each}
      {#if !making.length && live}
        <button type="button" class="b" onclick={reset}>recomeçar</button>
      {/if}
    </div>
    <label class="snd">
      <input type="checkbox" bind:checked={sound} disabled={!live} />
      <span>com o dim-dom e a voz chamando o número</span>
    </label>
  </div>

  <figcaption>
    Simulação com a Bolos da Nena. Os 7 segundos de tela cheia, um número por vez, são os do painel
    de verdade. Por padrão ele mostra só números.
  </figcaption>
</figure>

<style>
  figure.pn-w {
    display: grid;
    gap: 16px;
    margin: 12px 0;
    padding: 20px 14px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }
  .tv {
    padding: 8px;
    border-radius: 16px;
    background: var(--bezel);
    box-shadow: var(--shadow-e2);
  }
  .screen {
    position: relative;
    display: grid;
    gap: 10px;
    padding: 12px;
    min-height: 250px;
    border-radius: 9px;
    background: var(--bg);
    overflow: hidden;
  }
  figure .screen p {
    margin: 0;
    color: var(--ink);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 2px 12px;
  }
  figure .screen p.store {
    font: 600 1.125rem/1.2 var(--font-display);
  }
  figure .screen p.sub {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .cols {
    display: grid;
    grid-template-columns: 2fr 3fr;
    gap: 8px;
  }
  .col {
    display: grid;
    align-content: start;
    gap: 8px;
    padding: 10px;
    border-radius: 10px;
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--line);
  }
  .col.done {
    background: var(--success-soft);
  }
  figure .screen p.h {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 600 0.875rem/1.25 var(--font-display);
    color: var(--ink-muted);
  }
  figure .screen .done p.h {
    color: var(--success);
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .dot.sq {
    border-radius: 2px;
  }
  figure .screen ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure .screen li {
    display: grid;
    place-items: center;
    padding: 8px 2px;
    border-radius: 8px;
    background: var(--surface-sunken);
    font: 700 1.5rem/1 var(--font-display);
    color: var(--ink);
  }
  figure .screen .done li {
    background: var(--surface);
    font-size: 1.875rem;
    padding-block: 10px;
  }
  figure .screen .done li.latest {
    box-shadow:
      0 0 0 3px var(--spark),
      0 0 0 4px var(--ink);
  }
  figure .screen p.empty {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .stage {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 2px;
    padding: 16px;
    background: var(--spark);
    text-align: center;
    animation: rise var(--duration-smooth) var(--ease-soft);
  }
  .stage.still {
    animation: none;
  }
  figure .screen .stage p {
    color: var(--on-spark);
  }
  figure .screen p.call {
    font: 600 1.25rem/1.2 var(--font-display);
  }
  figure .screen p.big {
    font: 700 clamp(5.5rem, 26vw, 9rem) / 1 var(--font-display);
    letter-spacing: -0.04em;
  }
  figure .screen p.secs {
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .drain {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 6px;
    width: 100%;
    background: var(--on-spark);
    transform-origin: 0 50%;
    animation: drain 7s linear forwards;
  }
  .drain.still {
    animation: none;
    opacity: 0;
  }
  @keyframes drain {
    to {
      transform: scaleX(0);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  .ctl {
    display: grid;
    gap: 8px;
  }
  figure p.ask {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
  }
  .btns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .b {
    min-height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font: 600 0.9375rem var(--font-sans);
    cursor: pointer;
  }
  .b:disabled {
    cursor: default;
  }
  .b:focus-visible,
  .snd input:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .snd {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    font-size: 0.9375rem;
    color: var(--ink);
    cursor: pointer;
  }
  .snd input {
    width: 22px;
    height: 22px;
    accent-color: var(--primary);
  }
  figure.pn-w figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
  }

  @media (min-width: 560px) {
    figure.pn-w {
      padding: 26px 24px 22px;
    }
    .tv {
      padding: 12px;
    }
    .screen {
      aspect-ratio: 16 / 9;
      padding: 16px;
    }
    figure .screen li {
      font-size: 1.875rem;
    }
    figure .screen .done li {
      font-size: 2.5rem;
    }
  }
</style>
