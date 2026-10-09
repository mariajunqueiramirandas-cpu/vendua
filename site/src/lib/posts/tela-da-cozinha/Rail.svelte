<script lang="ts">
  import { flip } from 'svelte/animate';
  import { onMount } from 'svelte';
  import RailTicket from './RailTicket.svelte';
  import Timeline from './Timeline.svelte';
  import { PREP_CHIPS, WORD, byDue, clock, reducedMotion, urgency } from './rules';

  // The bold one: three tickets on the rail during the 18h rush, a clock you drag, and the same
  // three orders drawn as fuses on a timeline. Colours and words come from the real 60% / 100% rule.
  const orders = $state([
    {
      number: 30,
      name: 'Bia',
      acceptedAt: 2,
      prep: 45,
      rush: false,
      items: ['1× Bolo de chocolate molhadinho'],
    },
    {
      number: 31,
      name: 'Paulo',
      acceptedAt: 6,
      prep: 15,
      rush: false,
      items: ['2× Fatia de cenoura com brigadeiro'],
    },
    {
      number: 32,
      name: 'Carla',
      acceptedAt: 10,
      prep: 30,
      rush: false,
      items: ['1× Bolo de milho cremoso', '1× Café coado 300 ml'],
    },
  ]);

  let now = $state(28);
  let playing = $state(false);
  let live = $state(false);
  let reduced = $state(false);
  onMount(() => {
    live = true;
    reduced = reducedMotion();
  });

  const rail = $derived(
    [...orders].sort((a, b) => {
      const wa = now < a.acceptedAt;
      const wb = now < b.acceptedAt;
      if (wa !== wb) return wa ? 1 : -1;
      if (wa) return a.acceptedAt - b.acceptedAt;
      return byDue(a, b);
    }),
  );

  const readout = $derived.by(() => {
    const on = rail.filter((o) => now >= o.acceptedAt);
    if (!on.length) return `Às ${clock(now)}, nenhum pedido no trilho ainda.`;
    const parts = on.map((o) => {
      const e = now - o.acceptedAt;
      const left = o.prep - e;
      const u = urgency(e, o.prep);
      return `#${o.number} ${WORD[u]}${left > 0 ? `, faltam ${left} min` : left < 0 ? ` há ${-left} min` : ''}`;
    });
    return `Às ${clock(now)}, na ordem do trilho: ${parts.join('; ')}.`;
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  function play() {
    if (playing) return stop();
    if (now >= 60) now = 0;
    playing = true;
    timer = setInterval(() => {
      if (now >= 60) return stop();
      now += 1;
    }, 280);
  }
  function stop() {
    playing = false;
    clearInterval(timer);
  }
  $effect(() => stop);

  const bia = $derived(orders[0]!);
</script>

<figure class="rail-w" aria-label="O trilho de pedidos e o relógio de cada um">
  <div class="rail">
    <span class="bar" aria-hidden="true"></span>
    <ol class="stubs" aria-label="pedidos no trilho, na ordem da tela">
      {#each rail as o (o.number)}
        <li animate:flip={{ duration: reduced ? 0 : 320 }}>
          <RailTicket {...o} {now} />
        </li>
      {/each}
    </ol>
  </div>

  <div class="controls">
    <label class="scrub">
      <span class="lbl">Hora na cozinha <strong class="tnum">{clock(now)}</strong></span>
      <input
        type="range"
        min="0"
        max="60"
        step="1"
        bind:value={now}
        oninput={stop}
        aria-valuetext={clock(now)}
      />
    </label>
    <div class="btns">
      <button type="button" class="pill" onclick={play} aria-pressed={playing} disabled={!live}>
        {playing ? 'pausar o relógio' : 'deixar o relógio correr'}
      </button>
      <button
        type="button"
        class="pill"
        aria-pressed={bia.rush}
        onclick={() => (bia.rush = !bia.rush)}
        disabled={!live}
      >
        {bia.rush ? 'tirar a prioridade do #30' : 'passar o #30 na frente'}
      </button>
    </div>
  </div>

  <Timeline
    {orders}
    {now}
    chips={PREP_CHIPS}
    onPrep={(n, m) => {
      const o = orders.find((x) => x.number === n);
      if (o) o.prep = m;
    }}
    {live}
  />

  <p class="readout" aria-live="polite">{readout}</p>

  <figcaption>
    Simulação com a Bolos da Nena, feita com a regra real da tela: âmbar aos 60% do tempo de
    preparo, vermelho quando passa de 100%. Arraste a hora e troque o tempo de cada pedido.
  </figcaption>
</figure>

<style>
  figure.rail-w {
    display: grid;
    gap: 22px;
    margin: 12px 0;
    padding: 20px 14px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }
  .rail {
    position: relative;
    padding-top: 10px;
  }
  /* the steel bar the tickets hang from */
  .bar {
    position: absolute;
    top: 6px;
    left: -6px;
    right: -6px;
    height: 10px;
    border-radius: 999px;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--ink-faint) 60%, var(--surface)) 0%,
      var(--ink-faint) 55%,
      color-mix(in srgb, var(--ink-faint) 70%, var(--ink)) 100%
    );
    box-shadow: 0 2px 4px rgb(0 0 0 / 0.12);
  }
  figure ol.stubs {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: stretch;
    gap: 8px;
    margin: 0;
    padding: 12px 0 10px;
    list-style: none;
  }
  figure ol.stubs > li {
    display: grid;
    font-size: 1rem;
    line-height: 1.4;
  }

  .controls {
    display: grid;
    gap: 12px;
  }
  .scrub {
    display: grid;
    gap: 6px;
  }
  .lbl {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
  }
  .lbl strong {
    margin-left: 6px;
    font: 700 1.125rem var(--font-display);
  }
  input[type='range'] {
    width: 100%;
    min-height: 44px;
    accent-color: var(--primary);
    cursor: pointer;
  }
  .btns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .pill {
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.9375rem var(--font-sans);
    cursor: pointer;
  }
  .pill[aria-pressed='true'] {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--on-primary);
  }
  .pill:disabled {
    cursor: default;
  }
  .pill:focus-visible,
  input[type='range']:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  figure p.readout {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--ink);
  }
  figure.rail-w figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
  }

  @media (min-width: 560px) {
    figure.rail-w {
      padding: 26px 24px 22px;
    }
    figure ol.stubs {
      gap: 14px;
    }
  }
</style>
