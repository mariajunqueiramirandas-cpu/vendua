<script lang="ts">
  import Seg from './Seg.svelte';
  import {
    DEFAULTS,
    OPEN_FROM,
    OPEN_TO,
    clockLabel,
    hourLabel,
    isOpen,
    pauseEnd,
    whoAt,
    type Coverage,
    type Pause,
    type Who,
  } from './rules';

  // The day of the store on a 24-hour clock: pick when Duá answers and see, hour by hour, who
  // answers a new conversation first (floor.ts). The strip under it zooms into the first minutes.
  let coverage = $state<Coverage>(DEFAULTS.coverage);
  let wait = $state<'1' | '2' | '5'>(String(DEFAULTS.slowAfterMin) as '2');
  let pause = $state<Pause>('none');
  let hour = $state(15);

  const W = $derived(Number(wait));
  const pauseWin = $derived.by(() => {
    const until = pauseEnd(hour, pause);
    return until === null ? null : { from: hour, until };
  });
  const hours = $derived(
    Array.from({ length: 24 }, (_, h) => ({ h, who: whoAt(h, coverage, pauseWin) })),
  );
  const now = $derived(hours[hour].who);
  const open = $derived(isOpen(hour));

  const LEGEND: Record<Who, string> = {
    dua: 'O Duá responde na hora',
    primeiro: 'Você tem a vez; se demorar, o Duá entra',
    voce: 'Só você responde',
    rascunho: 'Só você responde; o Duá escreve rascunhos',
    pausa: 'Duá pausado: as conversas ficam com você',
  };
  const present = $derived(
    (['primeiro', 'voce', 'rascunho', 'dua', 'pausa'] as Who[]).filter((w) =>
      hours.some((x) => x.who === w),
    ),
  );

  const verdict = $derived.by(() => {
    const at = hourLabel(hour);
    if (now === 'pausa')
      return `Você pausou o Duá às ${at}. Até as ${hourLabel(pauseWin!.until)} as conversas ficam com você, e ele volta sozinho.`;
    if (now === 'rascunho')
      return `Em ensaio, o Duá não manda nada: às ${at} ele escreve o que diria, e quem responde é você. Depois você compara.`;
    if (coverage === 'always')
      return `Às ${at} o Duá responde na hora, como em qualquer hora do dia. Você assume quando quiser.`;
    if (!open)
      return `Às ${at} a loja está fechada: o Duá responde na hora e pode agendar o pedido para quando a loja abrir.`;
    if (now === 'voce')
      return `Às ${at} a loja está aberta, então quem responde é você. O Duá só entra depois que a loja fecha.`;
    return `Às ${at} a loja está aberta: a conversa espera você por ${W} min. Se ninguém responder, o Duá entra às ${clockLabel(hour * 60 + W)}.`;
  });

  // the first 6 minutes of a conversation that starts at the chosen hour
  const ZOOM = 6;
  const zoom = $derived.by(() => {
    if (now === 'primeiro')
      return [
        { who: 'voce' as const, from: 0, to: W, label: 'sua vez' },
        { who: 'dua' as const, from: W, to: ZOOM, label: 'Duá responde' },
      ];
    if (now === 'dua') return [{ who: 'dua' as const, from: 0, to: ZOOM, label: 'Duá responde' }];
    return [{ who: 'voce' as const, from: 0, to: ZOOM, label: 'só você' }];
  });

  // geometry: 0h at the top, clockwise
  const ang = (h: number) => (h / 24) * Math.PI * 2 - Math.PI / 2;
  const pt = (h: number, r: number) => [Math.cos(ang(h)) * r, Math.sin(ang(h)) * r];
  const f = (n: number) => n.toFixed(2);
  function sector(h0: number, h1: number, r1: number, r2: number) {
    const large = h1 - h0 > 12 ? 1 : 0;
    const [a, b] = pt(h0, r2);
    const [c, d] = pt(h1, r2);
    const [e, g] = pt(h1, r1);
    const [i, j] = pt(h0, r1);
    return `M${f(a)} ${f(b)}A${r2} ${r2} 0 ${large} 1 ${f(c)} ${f(d)}L${f(e)} ${f(g)}A${r1} ${r1} 0 ${large} 0 ${f(i)} ${f(j)}Z`;
  }
  const handIn = $derived(pt(hour + 0.5, 54));
  const hand = $derived(pt(hour + 0.5, 131));
</script>

<figure class="relogio" aria-labelledby="relogio-cap">
  <div class="panel">
    <div class="dial">
      <svg viewBox="-150 -150 300 300" role="img" aria-label="Relógio de 24 horas: {verdict}">
        <defs>
          <pattern
            id="dcv-primeiro"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect class="p-voce" width="8" height="8" />
            <rect class="p-dua" width="3" height="8" />
          </pattern>
          <pattern
            id="dcv-pausa"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <rect class="p-sunken" width="6" height="6" />
            <rect class="p-ink" width="1.5" height="6" />
          </pattern>
        </defs>

        <circle class="track" r="115" />
        <path class="store" d={sector(OPEN_FROM, OPEN_TO, 111, 119)} />

        {#each hours as x (x.h)}
          <path class="seg {x.who}" d={sector(x.h + 0.05, x.h + 0.95, 60, 104)} />
        {/each}
        <path class="sel" d={sector(hour + 0.05, hour + 0.95, 60, 104)} />

        {#each Array.from({ length: 24 }, (_, i) => i) as h (h)}
          {@const [x1, y1] = pt(h, 123)}
          {@const [x2, y2] = pt(h, h % 6 ? 126 : 129)}
          <line class="tick" {x1} {y1} {x2} {y2} />
        {/each}
        {#each [0, 6, 12, 18] as h (h)}
          {@const [x, y] = pt(h, 140)}
          <!-- the hand's knob takes the label's place when it points there -->
          {#if Math.abs(((hour + 0.5 - h + 36) % 24) - 12) < 10.5}
            <text class="num" {x} {y} dy="0.35em">{h}h</text>
          {/if}
        {/each}

        <circle class="hub" r="52" />
        <line class="hand" x1={handIn[0]} y1={handIn[1]} x2={hand[0]} y2={hand[1]} />
        <circle class="knob" cx={hand[0]} cy={hand[1]} r="5" />
        <text class="big" y="-4">{hourLabel(hour)}</text>
        <text class="small" y="20">{open ? 'loja aberta' : 'loja fechada'}</text>
      </svg>
    </div>

    <div class="controls">
      <Seg
        legend="Quando o Duá atende"
        name="dcv-coverage"
        min={130}
        bind:value={coverage}
        options={[
          { value: 'rehearsal', label: 'Ensaio' },
          { value: 'when_slow', label: 'Quando eu demorar' },
          { value: 'after_hours', label: 'Fora do horário' },
          { value: 'always', label: 'Sempre' },
        ]}
      />
      {#if coverage === 'when_slow'}
        <Seg
          legend="Quanto esperar antes de o Duá responder"
          name="dcv-wait"
          min={64}
          bind:value={wait}
          options={[
            { value: '1', label: '1 min' },
            { value: '2', label: '2 min' },
            { value: '5', label: '5 min' },
          ]}
        />
      {/if}
      <div class="range">
        <label for="dcv-hour">Uma mensagem chega às <strong>{hourLabel(hour)}</strong></label>
        <input
          id="dcv-hour"
          type="range"
          min="0"
          max="23"
          step="1"
          bind:value={hour}
          aria-valuetext={hourLabel(hour)}
        />
      </div>
      <Seg
        legend="Pausar o Duá nessa hora"
        name="dcv-pause"
        min={84}
        bind:value={pause}
        options={[
          { value: 'none', label: 'não' },
          { value: '1h', label: '1 hora' },
          { value: 'tomorrow', label: 'até amanhã' },
        ]}
      />
    </div>
  </div>

  <p class="verdict" aria-live="polite">{verdict}</p>

  <div class="zoom" aria-hidden="true">
    <p class="zoom-title">Os primeiros {ZOOM} minutos dessa conversa</p>
    <div class="bar">
      {#each zoom as z (z.from)}
        <span
          class="part {z.who}"
          style="left: {(z.from / ZOOM) * 100}%; width: {((z.to - z.from) / ZOOM) * 100}%"
          >{z.label}</span
        >
      {/each}
    </div>
    <div class="scale">
      {#each Array.from({ length: ZOOM + 1 }, (_, i) => i) as m (m)}
        <span style="left: {(m / ZOOM) * 100}%">{m === 0 ? hourLabel(hour) : `+${m}`}</span>
      {/each}
    </div>
  </div>

  <ul class="legend">
    <li><span class="sw store-sw"></span>Loja aberta (exemplo: das {OPEN_FROM}h às {OPEN_TO}h)</li>
    {#each present as w (w)}
      <li><span class="sw {w}"></span>{LEGEND[w]}</li>
    {/each}
  </ul>

  <figcaption id="relogio-cap">
    Simulação com a Bolos da Nena e as regras reais do Duá: as quatro opções, a espera de 1, 2 ou 5
    minutos e a pausa de 1 hora ou até as 6h do dia seguinte. O horário da loja é um exemplo.
  </figcaption>
</figure>

<style>
  figure.relogio {
    margin: 12px 0;
    display: grid;
    gap: 16px;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-e1);
    container-type: inline-size;
  }
  .panel {
    display: grid;
    gap: 20px;
  }
  @container (min-width: 560px) {
    .panel {
      grid-template-columns: 290px minmax(0, 1fr);
      align-items: center;
    }
  }
  .dial {
    width: min(100%, 300px);
    justify-self: center;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .track {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 1;
  }
  .store {
    fill: var(--ink);
  }
  .seg {
    stroke-width: 1;
    transition: fill var(--duration-smooth) var(--ease-soft);
  }
  .seg.dua {
    fill: var(--spark);
    stroke: color-mix(in srgb, var(--spark) 55%, var(--on-spark));
  }
  .seg.voce {
    fill: var(--info-soft);
    stroke: var(--info);
  }
  .seg.primeiro {
    fill: url(#dcv-primeiro);
    stroke: var(--info);
  }
  .seg.rascunho {
    fill: var(--surface-sunken);
    stroke: var(--ink-faint);
    stroke-dasharray: 3 3;
  }
  .seg.pausa {
    fill: url(#dcv-pausa);
    stroke: var(--ink-faint);
  }
  .p-voce {
    fill: var(--info-soft);
  }
  .p-dua {
    fill: var(--spark);
  }
  .p-sunken {
    fill: var(--surface-sunken);
  }
  .p-ink {
    fill: var(--ink-faint);
  }
  .sel {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2.5;
  }
  .tick {
    stroke: var(--ink-faint);
    stroke-width: 1.25;
  }
  .num {
    fill: var(--ink-muted);
    font: 600 13px var(--font-display);
    text-anchor: middle;
  }
  .knob {
    fill: var(--ink);
    stroke: var(--surface);
    stroke-width: 2;
  }
  .hand {
    stroke: var(--ink);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  .hub {
    fill: var(--surface);
    stroke: var(--line-strong);
  }
  .big {
    fill: var(--ink);
    font: 600 30px var(--font-display);
    letter-spacing: -0.02em;
    text-anchor: middle;
    font-variant-numeric: tabular-nums;
  }
  .small {
    fill: var(--ink-muted);
    font: 500 11.5px var(--font-sans);
    text-anchor: middle;
  }

  .controls {
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  .range {
    display: grid;
    gap: 6px;
  }
  .range label {
    font: 600 0.9375rem/1.3 var(--font-display);
    color: var(--ink);
  }
  .range strong {
    font-variant-numeric: tabular-nums;
  }
  input[type='range'] {
    width: 100%;
    min-height: 44px;
    margin: 0;
    accent-color: var(--ink);
    cursor: pointer;
  }
  input[type='range']:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
    border-radius: 8px;
  }

  figure.relogio p.verdict {
    margin: 0;
    padding: 14px 16px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    font-size: 1rem;
    line-height: 1.55;
    color: var(--ink);
  }

  .zoom {
    display: grid;
    gap: 6px;
  }
  figure.relogio p.zoom-title {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .bar {
    position: relative;
    height: 40px;
    border-radius: 10px;
    background: var(--surface-sunken);
    overflow: hidden;
  }
  .part {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    padding: 0 10px;
    font-size: 0.8125rem;
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    transition:
      left var(--duration-smooth) var(--ease-soft),
      width var(--duration-smooth) var(--ease-soft);
  }
  .part.voce {
    background: var(--info-soft);
    color: var(--info);
    box-shadow: inset 0 0 0 1px var(--info);
    border-radius: 10px 0 0 10px;
  }
  .part.dua {
    background: var(--spark);
    color: var(--on-spark);
  }
  .scale {
    position: relative;
    height: 18px;
    font-size: 0.75rem;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .scale span {
    position: absolute;
    transform: translateX(-50%);
  }
  .scale span:first-child {
    transform: none;
  }
  .scale span:last-child {
    transform: translateX(-100%);
  }

  figure.relogio ul.legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure.relogio ul.legend li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .sw {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 4px;
  }
  .sw.store-sw {
    height: 5px;
    background: var(--ink);
  }
  .sw.dua {
    background: var(--spark);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--spark) 55%, var(--on-spark));
  }
  .sw.voce {
    background: var(--info-soft);
    box-shadow: inset 0 0 0 1px var(--info);
  }
  .sw.primeiro {
    background: repeating-linear-gradient(45deg, var(--spark) 0 3px, var(--info-soft) 3px 8px);
    box-shadow: inset 0 0 0 1px var(--info);
  }
  .sw.rascunho {
    background: var(--surface-sunken);
    outline: 1px dashed var(--ink-faint);
    outline-offset: -1px;
  }
  .sw.pausa {
    background: repeating-linear-gradient(
      -45deg,
      var(--ink-faint) 0 1.5px,
      var(--surface-sunken) 1.5px 6px
    );
  }

  figure.relogio figcaption {
    max-width: none;
    margin: 0;
    text-align: left;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .seg,
    .part {
      transition: none;
    }
  }
</style>
