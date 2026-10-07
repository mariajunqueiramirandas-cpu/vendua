<script lang="ts">
  import Placa from './Placa.svelte';
  import {
    bagNote,
    DATE,
    DAY,
    dayName,
    hhmm,
    NENA,
    signWords,
    statusAt,
    WEEK,
    WEEKDAY,
    windowsOn,
    hShort,
    type Special,
    type Win,
  } from './rules';

  // Nena's week drawn as seven bars (NENA_HOURS), with the two national holidays of 15–21 nov 2026
  // from the admin's one-tap list (holidays.ts) and a "Mudar o horário de hoje" on Thursday. The
  // "agora" cursor reads the store's status the way Core derives it, and the sign shows the
  // Kernel's words for it.
  const HOLIDAYS: Special[] = [
    { day: 0, label: 'Proclamação da República', closed: true },
    { day: 5, label: 'Consciência Negra', closed: true },
  ];
  const TODAY = 4;
  const TODAY_SPECIAL: Special = {
    day: TODAY,
    label: 'Hoje',
    closed: false,
    win: { open: 480, close: 840 },
  };
  const STEP = 15;
  /** "8–18h", short enough for a 4-hour bar on a phone */
  const span = (w: Win) => `${hShort(w.open).replace(/h$/, '')}–${hShort(w.close)}`;

  let holidays = $state(true);
  let today = $state(true);
  let t = $state(TODAY * DAY + 15 * 60 + 30);

  const specials = $derived([...(holidays ? HOLIDAYS : []), ...(today ? [TODAY_SPECIAL] : [])]);
  const status = $derived(statusAt(t, specials));
  const sign = $derived(signWords(status, t));
  const day = $derived(Math.floor(t / DAY));
  const pct = (m: number) => `${(m / DAY) * 100}%`;
  const valuetext = $derived(
    `${dayName(t)} ${DATE[day]}, ${hhmm(t)}: ${sign.word}${sign.rest ? ` ${sign.rest}` : ''}`,
  );
  const openHours = $derived(
    Array.from({ length: 7 }, (_, d) =>
      windowsOn(d, specials).reduce((a, w) => a + (w.close - w.open), 0),
    ).reduce((a, b) => a + b, 0) / 60,
  );

  let grid: HTMLDivElement | undefined = $state();
  let dragging = false;

  function fromPointer(e: PointerEvent) {
    if (!grid) return;
    const rows = grid.querySelectorAll<HTMLElement>('.track');
    for (const [i, row] of [...rows].entries()) {
      const r = row.getBoundingClientRect();
      const hitY = e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6;
      if (hitY || (dragging && i === Math.floor(t / DAY))) {
        const x = Math.min(Math.max(e.clientX - r.left, 0), r.width - 1);
        const m = Math.round(((x / r.width) * DAY) / STEP) * STEP;
        t = Math.min(i * DAY + Math.min(m, DAY - STEP), WEEK - STEP);
        return;
      }
    }
  }
</script>

<figure class="semana">
  <div class="layers" role="group" aria-label="o que vale nesta semana">
    <label class="switch">
      <input type="checkbox" bind:checked={holidays} />
      <span class="knob" aria-hidden="true"></span>
      <span>Feriados nacionais: Proclamação da República e Consciência Negra</span>
    </label>
    <label class="switch">
      <input type="checkbox" bind:checked={today} />
      <span class="knob" aria-hidden="true"></span>
      <span>Mudar o horário de hoje (quinta): só até as 14h</span>
    </label>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="chart"
    bind:this={grid}
    onpointerdown={(e) => {
      dragging = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      fromPointer(e);
    }}
    onpointermove={(e) => dragging && fromPointer(e)}
    onpointerup={() => (dragging = false)}
    onpointercancel={() => (dragging = false)}
  >
    <div class="axis" aria-hidden="true">
      <span class="lab"></span>
      <span class="ticks">
        {#each [0, 6, 12, 18, 24] as h (h)}
          <span style="left: {pct(h * 60)}">{h}h</span>
        {/each}
      </span>
    </div>
    {#each WEEKDAY as name, d (name)}
      {@const s = specials.find((x) => x.day === d)}
      {@const usual = NENA[d]!}
      {@const wins = windowsOn(d, specials)}
      <div class="row" class:now={d === day}>
        <span class="lab">{name} <span class="date">{DATE[d]}</span></span>
        <span class="track">
          {#each [6, 12, 18] as h (h)}
            <span class="grid" style="left: {pct(h * 60)}" aria-hidden="true"></span>
          {/each}
          {#if s}
            {#each usual as w (w.open)}
              <span class="bar was" style="left: {pct(w.open)}; width: {pct(w.close - w.open)}"
              ></span>
            {/each}
          {/if}
          {#if s?.closed}
            <span class="bar shut">
              <span class="txt">{s.label}: fechado</span>
            </span>
          {/if}
          {#each wins as w (w.open)}
            <span
              class="bar"
              class:special={!!s}
              style="left: {pct(w.open)}; width: {pct(w.close - w.open)}"
            >
              <span class="txt">{s && s.label !== 'Hoje' ? `${s.label}: ` : ''}{span(w)}</span>
            </span>
          {/each}
          {#if !s && !wins.length}
            <span class="none">fechado</span>
          {/if}
          {#if d === day}
            <span class="cursor" style="left: {pct(t - d * DAY)}" aria-hidden="true"></span>
          {/if}
        </span>
      </div>
    {/each}
  </div>

  <div class="control">
    <label for="semana-agora" class="clabel">
      Arraste o agora: <strong>{dayName(t)} {DATE[day]}, {hhmm(t)}</strong>
    </label>
    <input
      id="semana-agora"
      type="range"
      min="0"
      max={WEEK - STEP}
      step={STEP}
      bind:value={t}
      aria-valuetext={valuetext}
    />
  </div>

  <div class="readout" aria-live="polite">
    <div class="mini"><Placa word={sign.word} rest={sign.rest} size="sm" /></div>
    <p class="says">
      {#if status.kind === 'open'}
        Pedido feito agora entra na hora.
      {:else}
        Na sacola: “{bagNote(status.kind === 'closed' ? status.opensAt : null, t, false)}”
      {/if}
    </p>
  </div>

  <figcaption>
    Exemplo com a semana da Bolos da Nena (terça a sábado das 8h às 18h, domingo até o meio-dia,
    segunda fechada), calculado com as regras da loja. Nesta semana, {openHours.toLocaleString(
      'pt-BR',
    )} horas abertas.
  </figcaption>
</figure>

<style>
  figure.semana {
    display: grid;
    gap: 16px;
    margin: 12px 0;
    padding: 18px 14px 16px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-e1);
    border: 1px solid var(--line);
  }
  .layers {
    display: grid;
    gap: 4px;
  }
  .switch {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    font-size: 0.9375rem;
    line-height: 1.35;
    color: var(--ink);
    cursor: pointer;
  }
  .switch input {
    position: absolute;
    opacity: 0;
    width: 44px;
    height: 28px;
    margin: 0;
    cursor: pointer;
  }
  .knob {
    flex: none;
    position: relative;
    width: 44px;
    height: 26px;
    border-radius: 999px;
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1.5px var(--ink-muted);
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .knob::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--ink-muted);
    box-shadow: var(--shadow-e1);
    transition: transform var(--duration-quick) var(--ease-soft);
  }
  .switch input:checked + .knob {
    background: var(--primary);
  }
  .switch input:checked + .knob::after {
    transform: translateX(18px);
    background: var(--on-primary);
  }
  .switch input:focus-visible + .knob {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  .chart {
    display: grid;
    gap: 6px;
    touch-action: pan-y;
    user-select: none;
    cursor: ew-resize;
  }
  .axis,
  .row {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .ticks {
    position: relative;
    height: 16px;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .ticks span {
    position: absolute;
    transform: translateX(-50%);
  }
  .ticks span:first-child {
    transform: none;
  }
  .ticks span:last-child {
    transform: translateX(-100%);
  }
  .lab {
    font-size: 0.875rem;
    font-weight: 650;
    color: var(--ink);
    white-space: nowrap;
  }
  .date {
    font-weight: 500;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .row.now .lab {
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
  }
  .track {
    position: relative;
    height: 34px;
    border-radius: 8px;
    background: var(--surface-sunken);
    container-type: inline-size;
  }
  .grid {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--line);
  }
  .bar {
    position: absolute;
    top: 4px;
    bottom: 4px;
    display: flex;
    align-items: center;
    padding-inline: 4px;
    border-radius: 6px;
    background: var(--primary);
    color: var(--on-primary);
    overflow: hidden;
    transition:
      left var(--duration-smooth) var(--ease-soft),
      width var(--duration-smooth) var(--ease-soft);
  }
  .bar.was {
    background: none;
    border: 1.5px dashed var(--ink-muted);
  }
  .bar.special {
    background: var(--warning-soft);
    color: var(--ink);
    box-shadow: inset 0 0 0 2px var(--warning);
  }
  .bar.shut {
    left: 0;
    right: 0;
    background: repeating-linear-gradient(
      -45deg,
      transparent 0 6px,
      color-mix(in srgb, var(--ink-muted) 22%, transparent) 6px 8px
    );
    color: var(--ink);
  }
  .txt {
    font-size: 0.75rem;
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }
  .shut .txt {
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--surface);
  }
  .none {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding-left: 10px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .cursor {
    position: absolute;
    z-index: 2;
    top: -6px;
    bottom: -6px;
    width: 3px;
    margin-left: -1.5px;
    border-radius: 2px;
    background: var(--danger);
  }
  .cursor::before {
    content: '';
    position: absolute;
    top: -4px;
    left: 50%;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    transform: translateX(-50%);
    background: var(--danger);
    box-shadow: 0 0 0 2px var(--surface);
  }
  @media (prefers-reduced-motion: reduce) {
    .bar,
    .knob,
    .knob::after {
      transition: none;
    }
  }

  .control {
    display: grid;
    gap: 6px;
  }
  .clabel {
    font-size: 0.9375rem;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  input[type='range'] {
    width: 100%;
    height: 44px;
    margin: 0;
    accent-color: var(--danger);
    cursor: pointer;
  }
  input[type='range']:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
    border-radius: 8px;
  }

  .readout {
    display: grid;
    grid-template-columns: minmax(0, 11rem) minmax(0, 1fr);
    align-items: end;
    gap: 14px;
  }
  .mini {
    min-width: 0;
  }
  figure.semana p.says {
    margin: 0 0 6px;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }
  figure.semana figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
  }
  @media (max-width: 420px) {
    .readout {
      grid-template-columns: minmax(0, 1fr);
      justify-items: center;
      text-align: center;
    }
    figure.semana p.says {
      margin: 0;
    }
  }
</style>
