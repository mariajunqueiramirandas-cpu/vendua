<script lang="ts">
  import { signupUrl, store } from '$lib/content';
  import { order } from '$lib/demos/pedido/script';
  import { onMount } from 'svelte';

  // The minutes after order #29 comes in, with the real rule (packages/core/src/admin/workers.ts
  // whatsappFallback): once a minute Core looks for orders still waiting past the accept target
  // (5 min by default) whose push reached no device, and writes once to the owners and managers
  // on WhatsApp. A push that reached one device is enough to skip it.
  const TARGET = 5;
  const LAST = 6;
  /** the admin's host, as the message links it (PUBLIC_ADMIN_URL) */
  const host = new URL(signupUrl()).host;
  const message = `Venduá: o pedido #${order.number} da ${store.name} está esperando há ${TARGET} min e o aviso não chegou em nenhum aparelho. Aceite em ${host}/admin/pedidos/…`;

  let arrived = $state(false);
  let minute = $state(LAST);
  let live = $state(false);
  onMount(() => (live = true));

  const at = (m: number) => `19h${String(12 + m).padStart(2, '0')}`;

  type Step = { t: number; when: string; title: string; body: string; tone?: 'ok' | 'bad' };
  const steps = $derived<Step[]>(
    arrived
      ? [
          {
            t: 0,
            when: at(0),
            title: `O pedido #${order.number} entra`,
            body: 'O aviso sai para os aparelhos com avisos ligados: o iPhone da Nena e o celular Android do balcão.',
          },
          {
            t: 0,
            when: at(0),
            title: 'Chegou nos dois aparelhos',
            body: 'Toca e vibra. Em Seus avisos, os dois aparecem com “chegou”.',
            tone: 'ok',
          },
          {
            t: TARGET,
            when: at(TARGET),
            title: 'Passou do tempo de aceite',
            body: 'Se ninguém aceitou, o cartão do pedido ganha a borda de atraso. WhatsApp não vai: o aviso chegou, alguém já sabe.',
          },
        ]
      : [
          {
            t: 0,
            when: at(0),
            title: `O pedido #${order.number} entra`,
            body: 'O aviso sai para os aparelhos com avisos ligados: o iPhone da Nena e o celular Android do balcão.',
          },
          {
            t: 0,
            when: at(0),
            title: 'Não chegou em nenhum aparelho',
            body: 'Os dois aparecem com “falhou”, e o Início já mostra: “O aviso de 1 pedido não chegou em nenhum aparelho”.',
            tone: 'bad',
          },
          {
            t: TARGET,
            when: at(TARGET),
            title: 'Passou do tempo de aceite',
            body: 'A Venduá confere a cada minuto: o pedido segue sem aceite e nenhum aviso chegou.',
          },
          {
            t: LAST,
            when: at(LAST),
            title: 'Donos e gerentes recebem no WhatsApp',
            body: 'Uma mensagem por pedido, para cada um:',
          },
        ],
  );
  const last = $derived(steps.filter((s) => s.t <= minute).at(-1)!);
  const valuetext = $derived(
    minute === 0
      ? 'na hora do pedido'
      : `${minute} ${minute === 1 ? 'minuto' : 'minutos'} depois do pedido`,
  );
</script>

<figure class="lane">
  <div class="panel">
    <fieldset class="seg">
      <legend class="sr-only">O aviso do pedido</legend>
      <label class:on={!arrived}>
        <input
          type="radio"
          name="lane-arrived"
          value="no"
          checked={!arrived}
          disabled={!live}
          onchange={() => (arrived = false)}
        />
        Não chegou em nenhum aparelho
      </label>
      <label class:on={arrived}>
        <input
          type="radio"
          name="lane-arrived"
          value="yes"
          checked={arrived}
          disabled={!live}
          onchange={() => (arrived = true)}
        />
        Chegou no celular
      </label>
    </fieldset>

    <div class="clock">
      <label for="lane-minute" class="clock-label">
        Minutos depois do pedido <output for="lane-minute" class="tnum">{minute} min</output>
      </label>
      <div class="track" style="--p: {minute / LAST}; --target: {TARGET / LAST}">
        <span class="fill" aria-hidden="true"></span>
        <span class="mark" aria-hidden="true"></span>
        <input
          id="lane-minute"
          type="range"
          min="0"
          max={LAST}
          step="1"
          bind:value={minute}
          disabled={!live}
          aria-valuetext={valuetext}
        />
      </div>
      <div class="ticks" aria-hidden="true">
        {#each Array.from({ length: LAST + 1 }, (_, i) => i) as i (i)}
          <span class:hit={i <= minute}>{i}</span>
        {/each}
      </div>
    </div>

    <ol class="steps">
      {#each steps as s, i (s.title)}
        {@const done = s.t <= minute}
        <li
          class:done
          class="tone-{s.tone ?? 'plain'}"
          aria-current={s === last ? 'step' : undefined}
        >
          <span class="dot" aria-hidden="true">
            {#if s.tone === 'ok'}✓{:else if s.tone === 'bad'}✕{:else}{i + 1}{/if}
          </span>
          <div class="text">
            <p class="when tnum">{s.when}{done ? '' : ', ainda não'}</p>
            <p class="title">{s.title}</p>
            <p class="body">{s.body}</p>
            {#if s.t === LAST && !arrived && done}
              <p class="bubble">{message}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
    <p class="sr-only" aria-live="polite">{valuetext}: {last.title}.</p>
  </div>
  <figcaption>
    Simulação com a Bolos da Nena, com a regra de verdade: 5 minutos de tempo de aceite (o padrão),
    conferido a cada minuto. A mensagem é a que a Venduá manda.
  </figcaption>
</figure>

<style>
  figure.lane {
    margin: 12px 0;
    display: grid;
    gap: 14px;
  }
  .panel {
    display: grid;
    gap: 22px;
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    margin: 0;
    padding: 4px;
    border: 0;
    border-radius: 16px;
    background: var(--surface-sunken);
  }
  .seg label {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 48px;
    padding: 6px 10px;
    border-radius: 12px;
    color: var(--ink-muted);
    font: 600 0.875rem/1.25 var(--font-sans);
    text-align: center;
    cursor: pointer;
  }
  .seg label.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-e1);
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

  .clock {
    display: grid;
    gap: 8px;
  }
  .clock-label {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--ink-muted);
    font: 600 0.875rem/1.3 var(--font-sans);
  }
  .clock-label output {
    color: var(--ink);
  }
  .track {
    position: relative;
    height: 44px;
  }
  .track::before,
  .fill {
    content: '';
    position: absolute;
    left: 11px;
    right: 11px;
    top: 50%;
    height: 6px;
    margin-top: -3px;
    border-radius: 999px;
    background: var(--surface-sunken);
  }
  .fill {
    right: auto;
    width: calc((100% - 22px) * var(--p));
    background: var(--primary);
  }
  .mark {
    position: absolute;
    left: calc(11px + (100% - 22px) * var(--target));
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 2px dashed var(--warning);
  }
  .track input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
  }
  .track input::-webkit-slider-runnable-track {
    background: transparent;
    height: 44px;
  }
  .track input::-moz-range-track {
    background: transparent;
  }
  .track input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px;
    height: 22px;
    margin-top: 11px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow:
      0 0 0 2px var(--primary),
      var(--shadow-e1);
  }
  .track input::-moz-range-thumb {
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 50%;
    background: var(--surface);
    box-shadow:
      0 0 0 2px var(--primary),
      var(--shadow-e1);
  }
  .track input:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
    border-radius: 12px;
  }
  .ticks {
    display: flex;
    justify-content: space-between;
    padding: 0 6px;
    color: var(--ink-muted);
    font: 500 0.8125rem/1 var(--font-sans);
    font-variant-numeric: tabular-nums;
  }
  .ticks span {
    width: 10px;
    text-align: center;
  }
  .ticks span.hit {
    color: var(--ink);
    font-weight: 700;
  }

  figure.lane ol.steps {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure.lane .steps li {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 14px;
    padding-bottom: 18px;
    font-size: 1rem;
    line-height: 1.5;
  }
  figure.lane .steps li:last-child {
    padding-bottom: 0;
  }
  /* still ahead on the clock: an open dot and a quieter title */
  figure.lane .steps li:not(.done) .dot {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
    color: var(--ink-muted);
  }
  figure.lane .steps li:not(.done) .title {
    color: var(--ink-muted);
  }
  /* the lane itself: a line from each dot down to the next */
  .steps li:not(:last-child)::before {
    content: '';
    position: absolute;
    left: 15px;
    top: 32px;
    bottom: 0;
    width: 2px;
    background: var(--line-strong);
  }
  .dot {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--surface-sunken);
    color: var(--ink);
    font: 700 0.875rem/1 var(--font-sans);
  }
  figure.lane .tone-ok.done .dot {
    background: var(--success-soft);
    color: var(--success);
    box-shadow: inset 0 0 0 1.5px var(--success);
  }
  figure.lane .tone-bad.done .dot {
    background: var(--danger-soft);
    color: var(--danger);
    box-shadow: inset 0 0 0 1.5px var(--danger);
  }
  figure.lane .text p {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  figure.lane .text .when {
    font-size: 0.8125rem;
    font-weight: 600;
  }
  figure.lane .text .title {
    margin-top: 2px;
    font: 600 1.0625rem/1.35 var(--font-display);
    color: var(--ink);
  }
  figure.lane .tone-ok.done .title {
    color: var(--success);
  }
  figure.lane .tone-bad.done .title {
    color: var(--danger);
  }
  figure.lane .text .bubble {
    margin-top: 10px;
    padding: 12px 14px;
    border-radius: 4px 16px 16px 16px;
    background: var(--success-soft);
    color: var(--ink);
    font-size: 0.9375rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  figure.lane figcaption {
    max-width: none;
  }
</style>
