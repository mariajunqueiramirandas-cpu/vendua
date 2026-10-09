<script lang="ts">
  import { onMount } from 'svelte';
  import { CUES, play, type Cue } from './sound';

  // The three cues drawn as notes: across is time, up is pitch (log scale), each dot a real note
  // from the admin's sound.ts. "ouvir" plays the same synthesis.
  const lanes: { id: Cue['id']; title: string; when: string }[] = [
    { id: 'ticket', title: 'Pedido novo', when: 'duas batidas na mesma nota' },
    { id: 'late', title: 'Atrasou', when: 'um tom que desce, uma vez por pedido' },
    { id: 'call', title: 'Pronto no painel', when: 'o dim-dom da chamada' },
  ];
  const NAME: Record<number, string> = { 784: 'Sol', 880: 'Lá', 659.25: 'Mi', 1046.5: 'Dó' };
  const LO = Math.log(659.25);
  const HI = Math.log(1046.5);
  const y = (f: number) => 22 + ((Math.log(f) - LO) / (HI - LO)) * 58;
  const x = (t: number) => 20 + (t / 0.42) * 60;

  let live = $state(false);
  let playing = $state<string | null>(null);
  onMount(() => (live = true));
  function hear(id: Cue['id']) {
    play(id);
    playing = id;
    setTimeout(() => (playing === id ? (playing = null) : null), 1400);
  }
</script>

<figure class="snd-w" aria-label="Os sons da cozinha, nota por nota">
  <div class="score">
    <p class="axis-y" aria-hidden="true">mais agudo</p>
    {#each lanes as l (l.id)}
      {@const notes = CUES[l.id].notes}
      <div class="lane" class:on={playing === l.id}>
        <div class="plot" aria-hidden="true">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <line
              x1={x(notes[0]![1])}
              y1={100 - y(notes[0]![0])}
              x2={x(notes[1]![1])}
              y2={100 - y(notes[1]![0])}
              vector-effect="non-scaling-stroke"
            />
          </svg>
          {#each notes as [f, t], k (k)}
            <span class="note" style="left: {x(t)}%; bottom: {y(f)}%">
              <span class="dot"></span>
              <span class="nm">{NAME[f]}</span>
            </span>
          {/each}
        </div>
        <p class="title">{l.title}</p>
        <p class="when">{l.when}</p>
        <button
          type="button"
          class="hear"
          disabled={!live}
          onclick={() => hear(l.id)}
          aria-label="ouvir o som de {l.title.toLowerCase()}">ouvir</button
        >
      </div>
    {/each}
  </div>

  <div class="toast">
    <span class="x" aria-hidden="true">!</span>
    <p>Pedido #31 foi cancelado. Pode parar o preparo.</p>
  </div>

  <figcaption>
    Notas tiradas do código da tela: cada som é sintetizado na hora, nada para baixar. O aviso de
    cancelamento aparece com o tom de atraso.
  </figcaption>
</figure>

<style>
  figure.snd-w {
    display: grid;
    gap: 16px;
    margin: 12px 0;
    padding: 20px 14px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }
  .score {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    padding-left: 18px;
  }
  figure p.axis-y {
    position: absolute;
    left: 0;
    top: 6px;
    margin: 0;
    writing-mode: vertical-rl;
    rotate: 180deg;
    font-size: 0.75rem;
    line-height: 1;
    color: var(--ink-muted);
  }
  .lane {
    display: grid;
    align-content: start;
    gap: 4px;
    min-width: 0;
  }
  .plot {
    position: relative;
    height: 120px;
    margin-bottom: 6px;
    border-radius: 10px;
    background:
      repeating-linear-gradient(180deg, transparent 0 23px, var(--line) 23px 24px), var(--surface);
    box-shadow: 0 0 0 1px var(--line);
  }
  .lane.on .plot {
    box-shadow: 0 0 0 2px var(--ink);
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  line {
    stroke: var(--ink-faint);
    stroke-width: 2;
    stroke-dasharray: 3 4;
  }
  .note {
    position: absolute;
    display: grid;
    justify-items: center;
    translate: -50% 50%;
  }
  .dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--ink);
    box-shadow: 0 0 0 3px var(--surface);
  }
  .nm {
    position: absolute;
    top: 18px;
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--ink-muted);
    white-space: nowrap;
  }
  figure p.title {
    margin: 0;
    font: 600 0.9375rem/1.3 var(--font-display);
    color: var(--ink);
  }
  figure p.when {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .hear {
    justify-self: start;
    min-height: 44px;
    margin-top: 6px;
    padding: 0 16px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.875rem var(--font-sans);
    cursor: pointer;
  }
  .hear:disabled {
    cursor: default;
  }
  .hear:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--danger-soft);
    box-shadow: inset 0 0 0 1px var(--danger);
  }
  .x {
    display: grid;
    place-items: center;
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--danger);
    color: var(--surface);
    font: 800 0.875rem var(--font-display);
  }
  figure .toast p {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.4;
    font-weight: 600;
    color: var(--ink);
  }
  figure.snd-w figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
  }
  @media (min-width: 560px) {
    figure.snd-w {
      padding: 26px 24px 22px;
    }
    .score {
      gap: 14px;
      padding-left: 22px;
    }
  }
</style>
