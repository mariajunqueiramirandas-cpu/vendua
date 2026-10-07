<script lang="ts">
  import {
    conversations,
    example,
    PLANS,
    SPAN_H,
    WINDOW_H,
    when,
    type Lane,
    type PlanId,
  } from './count';

  // Two days of messages on the store's WhatsApp and what they cost in Duá's conversations, counted
  // with the real 24-hour rule (count.ts). The visitor adds messages (a tap on a row, or the form)
  // and switches between Bandeira's month and the trial to see the meter run out.
  let { live }: { live: boolean } = $props();

  const lanes: Lane[] = $state(example());
  let who = $state('bia');
  let hour = $state(40);
  let plan: PlanId = $state('bandeira');
  const uid = $props.id();

  const convs = $derived(conversations(lanes));
  const msgs = $derived(lanes.reduce((n, l) => n + l.msgs.length, 0));
  const p = $derived(PLANS[plan]);
  const left = $derived(Math.max(0, p.limit - p.before));
  const fits = $derived(Math.min(convs.length, left));
  const over = $derived(convs.filter((c) => c.k > left));
  const nameOf = (id: string) => lanes.find((l) => l.id === id)?.name ?? '';

  const pct = (h: number) => `${(h / SPAN_H) * 100}%`;
  const ticks = [0, 6, 12, 18, 24, 30, 36, 42];
  const axis = [
    { at: 0, text: 'sexta' },
    { at: 12, text: '12h' },
    { at: 24, text: 'sábado' },
    { at: 36, text: '12h' },
  ];

  function add(id: string, at: number) {
    const l = lanes.find((x) => x.id === id);
    if (!l || l.msgs.length >= 24) return;
    const h = Math.min(SPAN_H - 0.25, Math.max(0, Math.round(at * 4) / 4));
    l.msgs.push(h);
  }

  function tap(e: MouseEvent, id: string) {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    add(id, ((e.clientX - r.left) / r.width) * SPAN_H);
  }

  function reset() {
    const fresh = example();
    lanes.splice(0, lanes.length, ...fresh);
  }
</script>

<div class="clock">
  <p class="tally" aria-live="polite">
    <span><strong>{msgs}</strong> mensagens</span>
    <span class="arrow" aria-hidden="true"></span>
    <span
      ><strong>{convs.length}</strong>
      {convs.length === 1 ? 'conversa' : 'conversas'} contadas</span
    >
  </p>

  <div class="chart">
    {#each lanes as l (l.id)}
      {@const mine = convs.filter((c) => c.lane === l.id)}
      <div class="lane">
        <p class="name">
          {l.name}{#if l.test}<span>teste</span>{/if}
        </p>
        <!-- the form below adds messages by keyboard; a tap on the row is a shortcut -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <div
          class="track"
          class:live
          role="img"
          aria-label="{l.name}: {l.msgs.length} mensagens, {l.test
            ? 'conversa de teste, não conta'
            : `${mine.length} ${mine.length === 1 ? 'conversa contada' : 'conversas contadas'}`}"
          onclick={live ? (e) => tap(e, l.id) : undefined}
        >
          {#each mine as c (c.k)}
            <span
              class="band"
              class:out={c.k > left}
              class:cut={c.start + WINDOW_H > SPAN_H}
              style:left={pct(c.start)}
              style:width={pct(Math.min(WINDOW_H, SPAN_H - c.start))}
            >
              {#if c.k <= left}<span class="tag" aria-hidden="true">+1</span>{/if}
            </span>
          {/each}
          {#each l.msgs as m, i (i)}
            <span class="dot" class:test={l.test} style:left={pct(m)}></span>
          {/each}
        </div>
      </div>
    {/each}
    <div class="lane axis" aria-hidden="true">
      <span></span>
      <div class="scale">
        {#each axis as a (a.at)}
          <span style:left={pct(a.at)}>{a.text}</span>
        {/each}
      </div>
    </div>
  </div>

  <ul class="legend">
    <li><span class="k-dot" aria-hidden="true"></span>mensagem</li>
    <li>
      <span class="k-band" aria-hidden="true"></span>conversa contada: 24 horas desde a primeira
      mensagem
    </li>
    <li><span class="k-test" aria-hidden="true"></span>teste da dona: não conta</li>
    {#if over.length}
      <li><span class="k-out" aria-hidden="true"></span>sem conversa: foi para a loja</li>
    {/if}
  </ul>

  {#if live}
    <div class="add" role="group" aria-label="Mandar uma mensagem de exemplo">
      <fieldset>
        <legend>Quem escreve</legend>
        {#each lanes as l (l.id)}
          <label class="pill">
            <input type="radio" name="{uid}-who" value={l.id} bind:group={who} />
            {l.name}{l.test ? ' (teste)' : ''}
          </label>
        {/each}
      </fieldset>
      <label class="range">
        <span>Quando: <strong>{when(hour)}</strong></span>
        <input
          type="range"
          min="0"
          max={SPAN_H - 0.5}
          step="0.5"
          bind:value={hour}
          aria-valuetext={when(hour)}
        />
      </label>
      <span class="buttons">
        <button type="button" class="go" onclick={() => add(who, hour)}>Mandar mensagem</button>
        <button type="button" onclick={reset}>Voltar ao exemplo</button>
      </span>
      <p class="tip-tap">Ou toque numa linha para pôr uma mensagem ali.</p>
    </div>
  {/if}

  <div class="meter">
    <fieldset class="plans" disabled={!live}>
      <legend>Conversas do plano</legend>
      {#each Object.entries(PLANS) as [id, x] (id)}
        <label class="pill">
          <input type="radio" name="{uid}-plan" value={id} bind:group={plan} />
          {x.label}: {x.limit}{id === 'teste' ? ' no total' : ' por mês'}
        </label>
      {/each}
    </fieldset>
    <div class="bar" role="img" aria-label="{p.before + fits} de {p.limit} conversas usadas">
      <span class="before" style:width="{(p.before / p.limit) * 100}%"></span>
      <span class="now" style:width="{(fits / p.limit) * 100}%"></span>
    </div>
    <p class="scale-row">
      <span>0</span><span>{p.limit}</span>
    </p>
    <p class="read" aria-live="polite">
      Exemplo: {p.before} já usadas {plan === 'teste' ? 'no teste' : 'neste mês'}. Com as
      {convs.length} destes dois dias, {p.before + fits} de {p.limit}.
      {#if over.length}
        <strong class="out-note">
          A conversa que {nameOf(over[0]!.lane)} abriu {when(over[0]!.start).replace(',', ' às')} já não
          cabe: chega uma vez a mensagem “Vou chamar alguém da loja para te ajudar.”, e a conversa espera
          por você no app.
        </strong>
      {/if}
    </p>
  </div>
</div>

<style>
  .clock {
    display: grid;
    gap: 16px;
    padding: 18px 16px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow:
      inset 0 0 0 1px var(--line),
      var(--shadow-e1);
    color: var(--ink);
    min-width: 0;
  }
  div.clock p {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  .clock .tally {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    font-size: 1rem;
    color: var(--ink);
  }
  p.tally strong {
    font: 600 2.25rem/1 var(--font-display);
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .arrow {
    width: 28px;
    height: 2px;
    align-self: center;
    background: var(--line-strong);
    position: relative;
  }
  .arrow::after {
    content: '';
    position: absolute;
    right: 0;
    top: -4px;
    width: 8px;
    height: 8px;
    border-top: 2px solid var(--line-strong);
    border-right: 2px solid var(--line-strong);
    transform: rotate(45deg);
  }

  .chart {
    display: grid;
    gap: 6px;
  }
  .lane {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .clock .name {
    display: grid;
    font-size: 0.875rem;
    font-weight: 650;
    line-height: 1.2;
    color: var(--ink);
  }
  .name span {
    font-weight: 500;
    font-size: 0.75rem;
    color: var(--ink-muted);
  }
  .track {
    position: relative;
    height: 44px;
    border-radius: 8px;
    overflow: hidden;
    /* sexta on the left half, sábado on the right; a faint line every six hours */
    background:
      linear-gradient(
        to right,
        transparent calc(50% - 1px),
        var(--line-strong) 0 calc(50% + 1px),
        transparent 0
      ),
      repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px 12.5%),
      linear-gradient(
        to right,
        var(--surface-sunken) 50%,
        color-mix(in srgb, var(--surface-sunken) 55%, var(--surface)) 50%
      );
  }
  .track.live {
    cursor: copy;
  }
  .band {
    position: absolute;
    top: 9px;
    bottom: 7px;
    border-radius: 6px;
    background: var(--spark-soft);
    box-shadow:
      inset 3px 0 0 var(--success),
      inset 0 0 0 1px color-mix(in srgb, var(--success) 35%, transparent);
  }
  @media (prefers-color-scheme: dark) {
    .band {
      background: color-mix(in srgb, var(--spark) 22%, transparent);
    }
  }
  .band.cut {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .band.out {
    background: repeating-linear-gradient(
      -45deg,
      var(--danger-soft) 0 6px,
      color-mix(in srgb, var(--danger) 18%, var(--surface)) 6px 8px
    );
    box-shadow:
      inset 3px 0 0 var(--danger),
      inset 0 0 0 1px color-mix(in srgb, var(--danger) 40%, transparent);
  }
  /* a badge on the band's top edge, clear of the dots in its middle */
  .tag {
    position: absolute;
    left: 6px;
    top: -6px;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--success);
    color: var(--surface);
    font-size: 0.625rem;
    font-weight: 700;
    line-height: 12px;
    white-space: nowrap;
    pointer-events: none;
  }
  .dot {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border-radius: 50%;
    background: var(--ink);
    box-shadow: 0 0 0 2px var(--surface);
    pointer-events: none;
  }
  .dot.test {
    background: var(--surface);
    box-shadow: inset 0 0 0 2px var(--ink-muted);
  }
  .axis {
    align-items: start;
  }
  .scale {
    position: relative;
    height: 18px;
  }
  .scale span {
    position: absolute;
    top: 0;
    font-size: 0.75rem;
    color: var(--ink-muted);
    white-space: nowrap;
  }

  div.clock ul.legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  ul.legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .k-dot,
  .k-test {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--ink);
  }
  .k-test {
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--ink-muted);
  }
  .k-out {
    width: 22px;
    height: 12px;
    border-radius: 4px;
    background: var(--danger-soft);
    box-shadow:
      inset 3px 0 0 var(--danger),
      inset 0 0 0 1px color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .k-band {
    width: 22px;
    height: 12px;
    border-radius: 4px;
    background: var(--spark-soft);
    box-shadow:
      inset 3px 0 0 var(--success),
      inset 0 0 0 1px color-mix(in srgb, var(--success) 35%, transparent);
  }

  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  legend {
    width: 100%;
    margin-bottom: 6px;
    padding: 0;
    font-size: 0.875rem;
    font-weight: 650;
    color: var(--ink);
  }
  .add {
    display: grid;
    gap: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .pill {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
  }
  .pill input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .pill:has(input:checked) {
    background: var(--primary);
    color: var(--on-primary);
    border-color: transparent;
  }
  .pill:has(input:focus-visible) {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  fieldset:disabled .pill {
    cursor: default;
  }
  .range {
    display: grid;
    gap: 4px;
    font-size: 0.875rem;
    color: var(--ink-muted);
  }
  .range strong {
    color: var(--ink);
  }
  .range input {
    width: 100%;
    min-height: 44px;
    accent-color: var(--primary);
  }
  .range input:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .buttons button {
    min-height: 44px;
    padding: 0 18px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.9375rem/1.2 var(--font-sans);
    cursor: pointer;
  }
  .buttons .go {
    background: var(--primary);
    color: var(--on-primary);
    border-color: transparent;
  }
  .buttons button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .buttons button:not(.go):hover {
    background: var(--hover);
  }

  .meter {
    display: grid;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .bar {
    display: flex;
    height: 22px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .bar span {
    transition: width var(--duration-smooth) var(--ease-soft);
  }
  .before {
    background: color-mix(in srgb, var(--ink-muted) 45%, var(--surface));
  }
  .now {
    background: var(--spark);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success) 50%, transparent);
  }
  .clock .scale-row {
    display: flex;
    justify-content: space-between;
    margin-top: -6px;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
  .clock .read {
    color: var(--ink);
  }
  .out-note {
    display: block;
    margin-top: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--danger-soft);
    font-weight: 600;
    color: var(--ink);
  }
  @media (prefers-reduced-motion: reduce) {
    .bar span {
      transition: none;
    }
  }
</style>
