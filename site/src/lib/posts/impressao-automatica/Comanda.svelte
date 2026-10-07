<script lang="ts">
  import { onMount } from 'svelte';
  import Paper from './Paper.svelte';
  import {
    brl,
    columnsFor,
    height,
    luiz,
    renderTicket,
    totalCents,
    type CodePage,
    type Paper as PaperW,
  } from './ticket';

  // The printer's settings as the admin's printer sheet has them (apps/admin/src/features/printers/
  // Printers.tsx: 80 mm, 1 copy, cut on and the standard code page by default), on order #29. Every
  // change lays the ticket out again with Core's rules; "imprimir comanda" feeds it out line by line.

  const ACCENTS: { value: CodePage; label: string; hint: string }[] = [
    {
      value: 'cp850',
      label: 'Padrão (serve na maioria)',
      hint: 'Sai com ç e ã. É a tabela que a maioria das térmicas entende.',
    },
    {
      value: 'cp860',
      label: 'Português (CP860)',
      hint: 'Sai igual, por outra tabela. Para a impressora que troca o ã por um símbolo na padrão.',
    },
    {
      value: 'ascii',
      label: 'Sem acentos',
      hint: 'Para a impressora que não acerta nenhuma: ç vira c, ã vira a.',
    },
  ];

  let paper = $state<PaperW>(80);
  let copies = $state(1);
  let cut = $state(true);
  let codepage = $state<CodePage>('cp850');

  const lines = $derived(renderTicket(luiz, { paper, codepage }));
  const units = $derived(height(lines));
  const hint = $derived(ACCENTS.find((a) => a.value === codepage)!.hint);

  // how many line heights are still inside the printer
  let inside = $state(0);
  let printing = $state(false);
  let status = $state('');
  let reduced = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return () => clearInterval(timer);
  });

  function print() {
    clearInterval(timer);
    const word = copies === 1 ? 'comanda' : `${copies} cópias da comanda`;
    if (reduced) {
      inside = 0;
      status = `Impressa: ${word} do pedido #29.`;
      return;
    }
    printing = true;
    status = 'Imprimindo…';
    inside = units + 3;
    timer = setInterval(() => {
      inside = Math.max(0, inside - 1);
      if (inside === 0) {
        clearInterval(timer);
        printing = false;
        status = `Impressa: ${word} do pedido #29.`;
      }
    }, 75);
  }

  // a setting changed mid-print: show the new layout whole
  $effect(() => {
    void [paper, codepage];
    clearInterval(timer);
    inside = 0;
    printing = false;
  });
</script>

<figure class="cm" aria-label="Simulação da comanda impressa">
  <div class="cm-grid">
    <div class="controls">
      <fieldset class="ctl">
        <legend>Largura do papel</legend>
        <div class="seg">
          {#each [58, 80] as const as w (w)}
            <label class:on={paper === w}>
              <input type="radio" name="cm-paper" value={w} bind:group={paper} />
              {w} mm
            </label>
          {/each}
        </div>
        <p class="note tnum" aria-live="polite">{columnsFor(paper)} letras por linha</p>
      </fieldset>

      <div class="ctl">
        <span class="lbl" id="cm-copies">Cópias</span>
        <div class="stepper" role="group" aria-labelledby="cm-copies">
          <button
            type="button"
            aria-label="menos uma cópia"
            disabled={copies <= 1}
            onclick={() => (copies = Math.max(1, copies - 1))}>−</button
          >
          <output class="tnum" aria-live="polite">{copies}</output>
          <button
            type="button"
            aria-label="mais uma cópia"
            disabled={copies >= 3}
            onclick={() => (copies = Math.min(3, copies + 1))}>+</button
          >
        </div>
        <p class="note">De 1 a 3, de cada pedido.</p>
      </div>

      <label class="ctl switch">
        <span>
          <span class="lbl">Cortar o papel</span>
          <span class="note">Desligue se a impressora não tem guilhotina.</span>
        </span>
        <input type="checkbox" role="switch" bind:checked={cut} />
      </label>

      <div class="ctl accents">
        <label class="lbl" for="cm-accents">Acentos</label>
        <select id="cm-accents" bind:value={codepage}>
          {#each ACCENTS as a (a.value)}
            <option value={a.value}>{a.label}</option>
          {/each}
        </select>
        <p class="note">{hint}</p>
      </div>

      <button type="button" class="go" onclick={print} disabled={printing}>
        imprimir comanda
      </button>
      <p class="sr" aria-live="polite">{status}</p>
    </div>

    <div class="stage">
      <div class="out" class:attached={!cut}>
        <div
          class="feeder"
          class:moving={printing}
          style:transform={inside ? `translateY(calc(${inside} * 1.36 * var(--fs)))` : undefined}
        >
          {#if cut}
            {#each Array.from({ length: copies - 1 }, (_, i) => i + 1) as k (k)}
              <div class="behind" class:shown={!printing} style:--k={k} aria-hidden="true"></div>
            {/each}
          {/if}
          <Paper {lines} {paper} edge={cut ? 'both' : 'top'} />
        </div>
      </div>
      <div class="printer" aria-hidden="true">
        <span class="mouth"></span>
        <span class="name">Cozinha</span>
      </div>
      <p class="cut-note">
        {#if cut}
          {copies === 1 ? 'Cortada e solta.' : `${copies} cópias, cada uma cortada.`}
        {:else}
          {copies === 1 ? 'Sem corte: você destaca à mão.' : `${copies} cópias emendadas no papel.`}
        {/if}
      </p>
    </div>
  </div>
  <figcaption>
    Simulação com a Bolos da Nena: o pedido #29 do Luiz, {brl(totalCents(luiz))}, com itens de
    exemplo. A quebra das linhas segue as regras da comanda de verdade.
  </figcaption>
</figure>

<style>
  figure.cm {
    margin: 12px 0;
    display: grid;
    gap: 14px;
  }
  .cm-grid {
    display: grid;
    gap: 20px;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }

  /* ── controls ── */
  .controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 16px;
    align-content: start;
  }
  .ctl {
    display: grid;
    gap: 6px;
    align-content: start;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .ctl legend,
  .lbl {
    padding: 0;
    font: 600 0.9375rem/1.3 var(--font-sans);
    color: var(--ink);
  }
  .ctl legend {
    margin-bottom: 6px;
  }
  figure.cm p.note {
    font-size: 0.8125rem;
    line-height: 1.35;
    color: var(--ink-muted);
  }
  .note {
    display: block;
    font-size: 0.8125rem;
    line-height: 1.35;
    color: var(--ink-muted);
  }
  .seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .seg label {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 44px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--ink-muted);
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  .seg label.on {
    background: var(--primary);
    color: var(--on-primary);
  }
  .seg input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }
  .seg label:has(input:focus-visible) {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .stepper {
    display: grid;
    grid-template-columns: 44px 1fr 44px;
    align-items: center;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .stepper button {
    height: 44px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--ink);
    font: 600 1.25rem/1 var(--font-sans);
    cursor: pointer;
  }
  .stepper button:disabled {
    color: var(--ink-faint);
    cursor: default;
  }
  .stepper output {
    text-align: center;
    font: 600 1.0625rem/1 var(--font-display);
    color: var(--ink);
  }
  .switch,
  .accents {
    grid-column: 1 / -1;
  }
  .switch {
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 12px;
    cursor: pointer;
  }
  .switch > span {
    display: grid;
    gap: 6px;
  }
  .switch input {
    appearance: none;
    position: relative;
    width: 48px;
    height: 28px;
    margin: 8px 0;
    border-radius: 999px;
    background: var(--line-strong);
    cursor: pointer;
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .switch input::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow-e1);
    transition: translate var(--duration-quick) var(--ease-soft);
  }
  .switch input:checked {
    background: var(--primary);
  }
  .switch input:checked::after {
    translate: 20px 0;
  }
  select {
    min-height: 44px;
    width: 100%;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--ink);
    font: 500 0.875rem/1.2 var(--font-sans);
  }
  .go {
    grid-column: 1 / -1;
    min-height: 48px;
    border: 0;
    border-radius: 999px;
    background: var(--spark);
    color: var(--on-spark);
    font: 600 1rem/1 var(--font-sans);
    cursor: pointer;
    transition: scale var(--duration-instant) var(--ease-soft);
  }
  .go:active {
    scale: 0.97;
  }
  .go:disabled {
    cursor: progress;
  }
  .stepper button:focus-visible,
  .switch input:focus-visible,
  select:focus-visible,
  .go:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* ── the printer and its paper ── */
  .stage {
    container-type: inline-size;
    display: grid;
    justify-items: center;
    min-width: 0;
  }
  .out {
    --w80: min(100cqi, 340px);
    --fs: calc(var(--w80) * 0.0365);
    position: relative;
    display: grid;
    justify-items: center;
    align-items: end;
    width: 100%;
    padding-top: 22px;
    overflow: hidden;
    /* the paper's shadow, which a mask would cut off */
    filter: drop-shadow(0 6px 10px rgb(18 60 50 / 0.16));
  }
  .out:not(.attached) {
    padding-bottom: 12px;
  }
  .feeder {
    position: relative;
    display: grid;
    justify-items: center;
  }
  .feeder.moving {
    transition: transform 70ms steps(1, end);
  }
  .feeder > :global(.paper) {
    position: relative;
  }
  .behind {
    position: absolute;
    inset: 0;
    width: auto;
    background: var(--surface);
    opacity: 0;
    transform: translate(calc(var(--k) * 7px), calc(var(--k) * -9px))
      rotate(calc(var(--k) * 1.6deg));
    mask:
      conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / 10px 51%
        repeat-x,
      conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 10px 51%
        repeat-x;
    transition: opacity var(--duration-smooth) var(--ease-soft);
  }
  .behind.shown {
    opacity: 1;
  }
  .printer {
    position: relative;
    display: grid;
    place-items: center;
    width: min(100%, 380px);
    height: 64px;
    margin-top: -4px;
    border-radius: 14px 14px 18px 18px;
    background: var(--primary);
    box-shadow: var(--shadow-e2);
  }
  .mouth {
    position: absolute;
    top: 10px;
    left: 50%;
    width: calc(min(100cqi, 340px) + 16px);
    max-width: calc(100% - 20px);
    height: 6px;
    translate: -50% 0;
    border-radius: 3px;
    background: var(--sky-6);
  }
  .name {
    margin-top: 16px;
    font: 600 0.8125rem/1 var(--font-display);
    letter-spacing: 0.02em;
    color: var(--on-primary);
    opacity: 0.8;
  }
  figure.cm p.cut-note {
    margin-top: 10px;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink-muted);
    text-align: center;
  }
  figure.cm figcaption {
    max-width: 46ch;
    margin-inline: auto;
  }

  @media (min-width: 640px) {
    .cm-grid {
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 24px;
      padding: 22px;
    }
    .controls {
      grid-template-columns: 1fr;
      gap: 18px;
    }
  }

  @media (prefers-color-scheme: dark) {
    .behind {
      background: color-mix(in srgb, var(--after-ink) 80%, var(--sky-5));
    }
    .out {
      filter: drop-shadow(0 6px 12px rgb(0 0 0 / 0.45));
    }
    .printer {
      background: var(--surface-raised);
      box-shadow:
        var(--shadow-e2),
        inset 0 0 0 1px var(--line-strong);
    }
    .name {
      color: var(--ink-muted);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .feeder.moving,
    .behind,
    .switch input,
    .switch input::after {
      transition: none;
    }
  }
</style>
