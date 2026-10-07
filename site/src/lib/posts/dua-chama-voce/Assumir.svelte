<script lang="ts">
  import Seg from './Seg.svelte';
  import { DEFAULTS, clockLabel } from './rules';

  // Taking a chat over by just answering from the store's phone (ingest.ts): every message of
  // the store restarts the window, and Duá takes back when it lapses, or on "devolver ao Duá".
  // The four windows are the admin's choices (Settings.tsx SILENCE).
  let silence = $state<'15' | '30' | '60' | '120'>(String(DEFAULTS.humanSilenceMin) as '30');
  let back = $state<'auto' | 'tap'>('auto');

  const START = 14 * 60;
  const SPAN = 150;
  const TOOK = 6;
  const LAST = 10;
  const TAP = 12;

  const end = $derived(back === 'tap' ? TAP : LAST + Number(silence));
  const pct = (m: number) => `${(Math.min(m, SPAN) / SPAN) * 100}%`;
  const ticks = [0, 60, 120];

  const msgs = [
    { at: 0, who: 'Bia', side: 'in', text: 'Vocês fazem bolo com nome escrito em cima?' },
    {
      at: 0,
      who: 'Duá',
      side: 'dua',
      text: 'Oi, Bia! Sou o Duá, assistente virtual da Bolos da Nena. Para quando seria o bolo?',
    },
    {
      at: TOOK,
      who: 'Nena, pelo celular',
      side: 'me',
      text: 'Bia, aqui é a Nena! Faço sim. Para quantas pessoas?',
    },
    { at: 9, who: 'Bia', side: 'in', text: 'Pra 20 pessoas, no sábado' },
    { at: LAST, who: 'Nena, pelo celular', side: 'me', text: 'Combinado! Já te passo o valor.' },
  ];

  const status = $derived(
    back === 'tap'
      ? `Você tocou “devolver ao Duá” às ${clockLabel(START + TAP)}: ele volta para essa conversa na hora.`
      : `Se você não escrever mais nada, o Duá volta às ${clockLabel(START + end)}. Cada mensagem sua recomeça a conta.`,
  );
</script>

<figure class="assumir" aria-labelledby="assumir-cap">
  <div class="chat">
    {#each msgs as m, i (i)}
      {#if m.at === TOOK && m.side === 'me'}
        <p class="sys">O Duá pausou nesta conversa: você respondeu pelo celular.</p>
      {/if}
      <div class="msg {m.side}">
        <p class="by">{m.who} <span>{clockLabel(START + m.at)}</span></p>
        <p class="body">{m.text}</p>
      </div>
    {/each}
    <p class="sys strong" aria-live="polite">{status}</p>
  </div>

  <div class="controls">
    <Seg
      legend="O Duá volta depois de"
      name="dcv-silence"
      min={56}
      bind:value={silence}
      options={[
        { value: '15', label: '15 min' },
        { value: '30', label: '30 min' },
        { value: '60', label: '1 h' },
        { value: '120', label: '2 h' },
      ]}
    />
    <Seg
      legend="Como a conversa volta"
      name="dcv-back"
      min={110}
      bind:value={back}
      options={[
        { value: 'auto', label: 'sozinha' },
        { value: 'tap', label: 'você devolve' },
      ]}
    />
  </div>

  <div class="lanes" aria-hidden="true">
    <div class="lane">
      <span class="name">Duá</span>
      <div class="track">
        <span class="bar dua" style="left: 0; width: {pct(TOOK)}"></span>
        <span class="bar dua" style="left: {pct(end)}; width: calc(100% - {pct(end)})"></span>
      </div>
    </div>
    <div class="lane">
      <span class="name">Você</span>
      <div class="track">
        <span class="bar me" style="left: {pct(TOOK)}; width: calc({pct(end)} - {pct(TOOK)})"
        ></span>
        {#each msgs.filter((m) => m.side === 'me') as m (m.at)}
          <span class="dot" style="left: {pct(m.at)}"></span>
        {/each}
      </div>
    </div>
    <div class="axis">
      <span class="name"></span>
      <div class="ticks">
        {#each ticks as t (t)}
          <span style="left: {pct(t)}">{clockLabel(START + t)}</span>
        {/each}
      </div>
    </div>
  </div>

  <figcaption id="assumir-cap">
    Simulação com a Bolos da Nena. As quatro esperas são as opções do app (o padrão é 30 min); a
    conversa e os horários são exemplo.
  </figcaption>
</figure>

<style>
  figure.assumir {
    margin: 12px 0;
    display: grid;
    gap: 20px;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-e1);
    container-type: inline-size;
  }
  figure.assumir p {
    margin: 0;
  }
  .chat {
    display: grid;
    gap: 8px;
    padding: 14px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }
  .msg {
    max-width: 82%;
    padding: 8px 12px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--line);
  }
  .msg.in {
    justify-self: start;
    border-bottom-left-radius: 4px;
  }
  .msg.dua,
  .msg.me {
    justify-self: end;
    border-bottom-right-radius: 4px;
  }
  .msg.dua {
    background: var(--spark-soft);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--spark) 60%, transparent);
  }
  .msg.me {
    background: var(--info-soft);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--info) 35%, transparent);
  }
  figure.assumir p.by {
    font-size: 0.75rem;
    font-weight: 650;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .by span {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  figure.assumir p.body {
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }
  figure.assumir p.sys {
    justify-self: center;
    max-width: 92%;
    padding: 4px 12px;
    border-radius: 10px;
    background: var(--surface);
    font-size: 0.8125rem;
    line-height: 1.45;
    text-align: center;
    color: var(--ink-muted);
  }
  figure.assumir p.sys.strong {
    color: var(--ink);
    font-weight: 600;
  }

  .controls {
    display: grid;
    gap: 14px;
  }
  @container (min-width: 560px) {
    .controls {
      grid-template-columns: 1.4fr 1fr;
    }
  }

  .lanes {
    display: grid;
    gap: 6px;
  }
  .lane,
  .axis {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .name {
    font: 600 0.8125rem/1 var(--font-display);
    color: var(--ink);
  }
  .track {
    position: relative;
    height: 30px;
    border-radius: 8px;
    background: var(--surface-sunken);
  }
  .bar {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 8px;
    border-radius: 8px;
    font-size: 0.75rem;
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    transition:
      left var(--duration-smooth) var(--ease-soft),
      width var(--duration-smooth) var(--ease-soft);
  }
  .bar.dua {
    background: var(--spark);
    color: var(--on-spark);
    justify-content: flex-start;
  }
  .bar.me {
    background: var(--info-soft);
    box-shadow: inset 0 0 0 1.5px var(--info);
  }
  .dot {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    border-radius: 50%;
    background: var(--info);
  }
  .ticks {
    position: relative;
    height: 18px;
    font-size: 0.6875rem;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .ticks span {
    position: absolute;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .ticks span:first-child {
    transform: none;
  }

  figure.assumir figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .bar {
      transition: none;
    }
  }
</style>
