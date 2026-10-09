<script lang="ts">
  import { onMount } from 'svelte';
  import Conversa from './Conversa.svelte';
  import { checks, RUN, score } from './oculto';

  // The Cliente oculto board (apps/admin/src/features/vendedor/ClienteOculto.tsx) over a scripted
  // run: the grade, the checks, and each test shopper's conversation graded against its hidden
  // order. It opens on the one miss, the case the screen exists for.
  const results = RUN.map((sc) => ({ sc, ...score(sc) }));
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const orders = RUN.filter(
    (sc) => sc.check === 'pedido certo' || sc.check === 'opções certas',
  ).length;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  let open = $state(results.findIndex((r) => !r.passed));
  let play = $state(false);
  let reduced = $state(false);
  let run = $state(0);
  onMount(() => {
    reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  function pick(i: number) {
    if (open === i) return;
    open = i;
    play = true;
    run++;
  }

  // the ring: passed over total, drawn as a stroke on a circle of circumference 2πr
  const R = 34;
  const C = 2 * Math.PI * R;
</script>

<figure class="oculto" aria-labelledby="oculto-cap">
  <div class="sheet">
    <div class="grade">
      <svg viewBox="0 0 84 84" role="img" aria-label="{passed} de {total} pedidos certos">
        <circle cx="42" cy="42" r={R} class="track" />
        <circle
          cx="42"
          cy="42"
          r={R}
          class="arc"
          stroke-dasharray="{(passed / total) * C} {C}"
          transform="rotate(-90 42 42)"
        />
        <text x="42" y="40" class="n">{passed}</text>
        <text x="42" y="56" class="of">de {total}</text>
      </svg>
      <div class="gtext">
        <p class="big">pedidos saíram certos</p>
        <p class="sub">
          Cada cliente de teste tinha um pedido escondido. Comparamos item por item com o que o Duá
          fechou.
        </p>
      </div>
    </div>

    <ul class="checks">
      <li class="done">
        <span class="ic" aria-hidden="true">✓</span>
        <span class="t">Preço certo em todos os pedidos <small>calculado pela loja</small></span>
        <span class="v tnum">{orders}/{orders}</span>
      </li>
      {#each checks(RUN) as [check, c] (check)}
        <li class:done={c.passed === c.total} class:miss={c.passed < c.total}>
          <span class="ic" aria-hidden="true">{c.passed === c.total ? '✓' : '!'}</span>
          <span class="t">{cap(check)}</span>
          <span class="v tnum">{c.passed}/{c.total}</span>
        </li>
      {/each}
    </ul>

    <p class="lbl" id="oculto-list">Os clientes de teste desta rodada</p>
    <ul class="list" aria-labelledby="oculto-list">
      {#each results as r, i (r.sc.name)}
        <li>
          <button
            type="button"
            class="row"
            class:miss={!r.passed}
            aria-expanded={open === i}
            aria-controls="oculto-conv-{i}"
            onclick={() => pick(i)}
          >
            <span class="ic" aria-hidden="true">{r.passed ? '✓' : '!'}</span>
            <span class="name">{r.sc.name}</span>
            <span class="word">{r.passed ? 'certo' : 'errou'}</span>
          </button>
          {#if open === i}
            <div id="oculto-conv-{i}">
              {#key run}
                <Conversa sc={r.sc} {play} {reduced} />
              {/key}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
  <figcaption id="oculto-cap">
    Simulação com a Bolos da Nena: uma rodada de exemplo, com a mesma conferência do app, item por
    item. Toque num cliente de teste para ver a conversa.
  </figcaption>
</figure>

<style>
  .oculto {
    margin: 16px 0;
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .sheet {
    display: grid;
    gap: 18px;
    padding: 20px 16px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow:
      var(--shadow-e2),
      inset 0 0 0 1px var(--line);
    background-image: repeating-linear-gradient(
      180deg,
      transparent 0 31px,
      color-mix(in srgb, var(--info) 9%, transparent) 31px 32px
    );
    min-width: 0;
  }
  @media (min-width: 560px) {
    .sheet {
      padding: 24px 26px;
    }
  }
  .grade {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .grade svg {
    width: 96px;
    height: 96px;
    flex: none;
  }
  .track {
    fill: var(--surface);
    stroke: var(--surface-sunken);
    stroke-width: 8;
  }
  .arc {
    fill: none;
    stroke: var(--success);
    stroke-width: 8;
    stroke-linecap: round;
  }
  .n {
    text-anchor: middle;
    font: 600 26px var(--font-display);
    fill: var(--ink);
  }
  .of {
    text-anchor: middle;
    font: 500 11px var(--font-sans);
    fill: var(--ink-muted);
  }
  figure.oculto p {
    margin: 0;
    color: var(--ink);
  }
  figure.oculto p.big {
    font: 600 1.25rem/1.25 var(--font-display);
    letter-spacing: -0.01em;
  }
  figure.oculto p.sub {
    margin-top: 4px;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  figure.oculto ul {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure.oculto li {
    font-size: 0.9375rem;
    line-height: 1.35;
    color: var(--ink);
  }
  .checks li {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 6px 0;
    border-top: 1px solid var(--line);
  }
  .checks li:first-child {
    border-top: 0;
  }
  .t small {
    display: block;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .v {
    font-weight: 650;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: 0.8125rem;
    font-weight: 800;
    background: var(--success);
    color: var(--surface);
  }
  .miss .ic {
    background: var(--warning);
  }
  figure.oculto p.lbl {
    font-size: 0.9375rem;
    font-weight: 650;
  }
  .list {
    gap: 8px !important;
  }
  .list > li {
    display: grid;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 48px;
    padding: 8px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    font: 500 0.9375rem/1.35 var(--font-sans);
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--hover);
  }
  .row[aria-expanded='true'] {
    border-color: var(--ink);
  }
  .row.miss {
    border-color: color-mix(in srgb, var(--warning) 55%, var(--line-strong));
  }
  .row.miss[aria-expanded='true'] {
    border-color: var(--warning);
  }
  .row:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .name {
    overflow-wrap: anywhere;
  }
  .word {
    font-size: 0.8125rem;
    font-weight: 650;
    color: var(--success);
  }
  .row.miss .word {
    color: var(--warning);
  }
  figure.oculto figcaption {
    max-width: none;
    text-align: left;
  }
</style>
