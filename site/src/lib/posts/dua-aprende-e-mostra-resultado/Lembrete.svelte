<script lang="ts">
  import { CLOSE, DAY, dayWord, hhmm, OPEN, plan, WINDOW } from './lembrete';

  // The stopped-sacola reminder on a 24 h band that starts at the shopper's last message: the
  // delay slider is Core's range, the store's hours (9h to 19h) are an example.
  const LASTS = [
    { m: 11 * 60 + 20, label: '11:20' },
    { m: 18 * 60 + 50, label: '18:50' },
    { m: 22 * 60 + 10, label: '22:10' },
  ];
  let delay = $state(15);
  let last = $state(LASTS[1]!.m);

  const p = $derived(plan(last, delay));
  const pos = (m: number) => `${((m - last) / WINDOW) * 100}%`;

  // the store's hours inside the window, open and closed, left to right
  const bands = $derived.by(() => {
    const out: { from: number; to: number; open: boolean }[] = [];
    const end = last + WINDOW;
    let t = last;
    while (t < end) {
      const day = Math.floor(t / DAY) * DAY;
      const edges = [day + OPEN, day + CLOSE, day + DAY + OPEN];
      const next = Math.min(
        end,
        edges.find((e) => e > t)!,
      );
      const open = t >= day + OPEN && t < day + CLOSE;
      out.push({ from: t, to: next, open });
      t = next;
    }
    return out;
  });
  const ticks = $derived.by(() => {
    const out: { m: number; label: string }[] = [];
    for (let m = Math.ceil((last + 150) / 360) * 360; m < last + WINDOW - 60; m += 360)
      out.push({ m, label: `${(m % DAY) / 60}h` });
    return out;
  });

  const said = $derived(
    p.at === null
      ? 'Passou de 24 horas: ele não escreve mais.'
      : !p.waited
        ? `O Duá escreve a partir das ${hhmm(p.at)}, ${delay} min depois da última mensagem.`
        : `Às ${hhmm(p.due)} a loja está fechada. O lembrete espera a loja abrir: ${dayWord(p.at, last)} às ${hhmm(p.at)}, ainda dentro das 24 horas.`,
  );
</script>

<figure class="lembrete" aria-labelledby="lembrete-cap">
  <div class="sheet">
    <div class="controls">
      <div class="field">
        <label for="lembrete-delay">Lembrar depois de</label>
        <output for="lembrete-delay" class="tnum">{delay} min</output>
        <input
          id="lembrete-delay"
          type="range"
          min="5"
          max="120"
          step="5"
          bind:value={delay}
          aria-valuetext="{delay} minutos"
        />
      </div>
      <div class="field">
        <p class="lbl" id="lembrete-last">Última mensagem do cliente</p>
        <div class="lasts" role="group" aria-labelledby="lembrete-last">
          {#each LASTS as l (l.m)}
            <button type="button" aria-pressed={last === l.m} onclick={() => (last = l.m)}
              >{l.label}</button
            >
          {/each}
        </div>
      </div>
    </div>

    <div class="clock" aria-hidden="true">
      <div class="band">
        <div class="segs">
          {#each bands as b (b.from)}
            <span
              class="seg"
              class:open={b.open}
              style:left={pos(b.from)}
              style:width="calc({pos(b.to)} - {pos(b.from)})"
              >{#if b.to - b.from >= 150}<i>{b.open ? 'aberta' : 'fechada'}</i>{/if}</span
            >
          {/each}
        </div>
        <span class="wait" style:width="calc({pos(p.due)} - 0%)"></span>
        {#if p.at !== null}
          <span class="pin" style:left={pos(p.at)}><b>lembrete {hhmm(p.at)}</b></span>
        {/if}
      </div>
      <div class="ticks">
        <span class="start">{hhmm(last)}</span>
        {#each ticks as t (t.m)}
          <span style:left={pos(t.m)}>{t.label}</span>
        {/each}
        <span class="end">+24 h</span>
      </div>
    </div>

    <p class="said" aria-live="polite">{said}</p>
  </div>
  <figcaption id="lembrete-cap">
    Feito com a regra real do lembrete. O horário da loja, das 9h às 19h, é um exemplo. A regra
    aceita de 5 a 120 minutos; no app você escolhe entre 10, 15, 30 e 60.
  </figcaption>
</figure>

<style>
  .lembrete {
    margin: 16px 0;
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .sheet {
    display: grid;
    gap: 22px;
    padding: 20px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow:
      var(--shadow-e1),
      inset 0 0 0 1px var(--line);
    min-width: 0;
  }
  @media (min-width: 560px) {
    .sheet {
      padding: 24px 26px;
    }
  }
  .controls {
    display: grid;
    gap: 16px;
  }
  @media (min-width: 560px) {
    .controls {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      gap: 24px;
    }
  }
  .field {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 6px 12px;
    min-width: 0;
  }
  .field label,
  figure.lembrete p.lbl {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.3;
    font-weight: 650;
    color: var(--ink);
  }
  output {
    font: 600 1.25rem/1 var(--font-display);
    color: var(--ink);
  }
  input[type='range'] {
    grid-column: 1 / -1;
    width: 100%;
    height: 44px;
    margin: 0;
    accent-color: var(--primary);
    cursor: pointer;
  }
  input[type='range']:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
    border-radius: 8px;
  }
  .lasts {
    grid-column: 1 / -1;
    display: inline-flex;
    gap: 6px;
  }
  .lasts button {
    min-height: 44px;
    min-width: 64px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.9375rem/1 var(--font-sans);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .lasts button[aria-pressed='true'] {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--on-primary);
  }
  .lasts button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .clock {
    display: grid;
    gap: 6px;
    padding-top: 30px;
  }
  .band {
    position: relative;
    height: 40px;
    border-radius: 10px;
  }
  .seg {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: repeating-linear-gradient(
      135deg,
      var(--surface-sunken) 0 6px,
      color-mix(in srgb, var(--surface-sunken) 55%, var(--line-strong)) 6px 8px
    );
  }
  .segs {
    position: absolute;
    inset: 0;
    border-radius: 10px;
    overflow: hidden;
  }
  .seg.open {
    background: var(--spark-soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--spark) 70%, var(--line-strong));
  }
  .seg i {
    font-style: normal;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .seg.open i {
    color: var(--ink);
  }
  .wait {
    position: absolute;
    left: 0;
    top: -8px;
    height: 4px;
    border-radius: 2px;
    background: var(--ink-muted);
    transition: width var(--duration-smooth) var(--ease-soft);
  }
  .pin {
    position: absolute;
    top: -12px;
    bottom: -6px;
    width: 3px;
    margin-left: -1.5px;
    border-radius: 2px;
    background: var(--primary);
    transition: left var(--duration-smooth) var(--ease-soft);
  }
  .pin b {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font-size: 0.75rem;
    font-weight: 650;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .ticks {
    position: relative;
    height: 18px;
    font-size: 0.75rem;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .ticks span {
    position: absolute;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .ticks .start {
    left: 0;
    transform: none;
    font-weight: 650;
    color: var(--ink);
  }
  .ticks .end {
    right: 0;
    transform: none;
  }
  figure.lembrete p.said {
    margin: 0;
    min-height: 3em;
    font-size: 1rem;
    line-height: 1.5;
    color: var(--ink);
    font-weight: 500;
  }
  figure.lembrete figcaption {
    max-width: none;
    text-align: left;
  }
  @media (prefers-reduced-motion: reduce) {
    .wait,
    .pin {
      transition: none;
    }
  }
</style>
