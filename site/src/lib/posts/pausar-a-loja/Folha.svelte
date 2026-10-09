<script lang="ts">
  import { hhmm, PAUSE_MESSAGE_MAX, PREP_MINUTES, when, type DemandSpan, type Span } from './rules';

  // The owner's side: the admin's StatusSheet (apps/admin/src/features/store/StatusSheet.tsx),
  // drawn small, with its real titles, chips, toasts and limits. The Início's two buttons
  // ("pausar", "muitos pedidos?") open it on the pause or on "Muitos pedidos agora".

  let {
    mode = $bindable(),
    span = $bindable(),
    message = $bindable(),
    now,
    pausedUntil,
    demandUntil,
    toast,
    ended,
    running,
    onpause,
    onresume,
    onundo,
    ondemand,
    onfastforward,
  }: {
    mode: 'pause' | 'demand';
    span: Span;
    message: string;
    now: number;
    /** undefined: not paused; null: until the owner comes back */
    pausedUntil: number | null | undefined;
    demandUntil: number | null;
    toast: { text: string; undo: boolean } | null;
    /** a line saying a pause or the warning ended by itself */
    ended: string | null;
    running: boolean;
    onpause: () => void;
    onresume: () => void;
    onundo: () => void;
    ondemand: (s: DemandSpan | 'off') => void;
    onfastforward: (to: number) => void;
  } = $props();

  const SPANS: { value: Span; label: string }[] = [
    { value: '15m', label: '15 min' },
    { value: '1h', label: '1 hora' },
    { value: 'today', label: 'resto do dia' },
    { value: 'indefinite', label: 'até eu voltar' },
  ];
  const DEMAND: { value: DemandSpan; label: string }[] = [
    { value: '30m', label: '30 min' },
    { value: '1h', label: '1 hora' },
    { value: '2h', label: '2 horas' },
    { value: 'today', label: 'resto do dia' },
  ];

  const paused = $derived(pausedUntil !== undefined);
  const demandOn = $derived(demandUntil !== null && demandUntil > now);
  const left = $derived(PAUSE_MESSAGE_MAX - message.length);
</script>

<div class="sheet">
  <div class="home" role="group" aria-label="botões do Início">
    <button
      type="button"
      class="pill"
      aria-pressed={mode === 'pause'}
      onclick={() => (mode = 'pause')}
    >
      <span class="ico pause" aria-hidden="true"></span>{paused ? 'pausada' : 'pausar'}
    </button>
    <button
      type="button"
      class="pill"
      aria-pressed={mode === 'demand'}
      onclick={() => (mode = 'demand')}
    >
      <span class="ico fire" aria-hidden="true"></span>{demandOn
        ? `muitos pedidos até ${hhmm(demandUntil!)}`
        : 'muitos pedidos?'}
    </button>
  </div>

  <div class="card">
    {#if mode === 'pause'}
      {#if !paused}
        <p class="title">Pausar a loja</p>
        <p class="desc">
          Ninguém consegue fazer pedido enquanto estiver pausada. Os pedidos em andamento continuam.
        </p>
        <fieldset class="field">
          <legend class="label">Por quanto tempo?</legend>
          <div class="chips">
            {#each SPANS as o (o.value)}
              <label class="chip" class:on={span === o.value}>
                <input type="radio" name="pausar-span" value={o.value} bind:group={span} />
                {o.label}
              </label>
            {/each}
          </div>
        </fieldset>
        <div class="field">
          <label class="label" for="pausar-recado">
            Recado para quem entrar na loja <span class="opt">(opcional)</span>
          </label>
          <textarea
            id="pausar-recado"
            maxlength={PAUSE_MESSAGE_MAX}
            rows="3"
            placeholder="Ex.: Voltamos às 18h com fornada nova!"
            aria-describedby="pausar-conta"
            bind:value={message}></textarea>
          <p class="helper">
            <span>Aparece no topo da sua loja.</span>
            <span id="pausar-conta" class="count" class:low={left <= 20}>
              {message.length} de {PAUSE_MESSAGE_MAX}
            </span>
          </p>
        </div>
        <button type="button" class="big" onclick={onpause}>
          <span class="ico pause light" aria-hidden="true"></span>pausar agora
        </button>
      {:else}
        <p class="title">Sua loja está pausada</p>
        <p class="desc">
          {pausedUntil !== null
            ? `Volta sozinha ${when(pausedUntil!, now)}.`
            : 'Fica pausada até você voltar.'}
        </p>
        <button type="button" class="big" onclick={onresume}>
          <span class="ico play" aria-hidden="true"></span>voltar a aceitar pedidos
        </button>
        {#if pausedUntil !== null}
          <button
            type="button"
            class="sim"
            disabled={running}
            onclick={() => onfastforward(pausedUntil!)}
          >
            Simulação: adiantar o relógio até {hhmm(pausedUntil!)}
          </button>
        {/if}
      {/if}
    {:else}
      <p class="title">Muitos pedidos agora</p>
      <p class="desc">
        Os pedidos continuam chegando, e quem entra na loja vê que o preparo está levando mais que
        os ~{PREP_MINUTES} min de sempre.
      </p>
      {#if demandOn}
        <p class="desc strong">Ligado até {hhmm(demandUntil!)}. Desliga sozinho.</p>
      {/if}
      <p class="label">{demandOn ? 'Mudar para' : 'Ligar por'}</p>
      <div
        class="chips"
        role="group"
        aria-label={demandOn ? 'mudar até quando' : 'ligar por quanto tempo'}
      >
        {#each DEMAND as o (o.value)}
          <button type="button" class="chip" onclick={() => ondemand(o.value)}>{o.label}</button>
        {/each}
      </div>
      {#if demandOn}
        <button type="button" class="ghost" onclick={() => ondemand('off')}>
          desligar o aviso
        </button>
        <button
          type="button"
          class="sim"
          disabled={running}
          onclick={() => onfastforward(demandUntil!)}
        >
          Simulação: adiantar o relógio até {hhmm(demandUntil!)}
        </button>
      {/if}
    {/if}

    <div class="foot" aria-live="polite">
      {#if ended}
        <p class="ended">{ended}</p>
      {/if}
      {#if toast}
        <p class="toast">
          <span>{toast.text}</span>
          {#if toast.undo}
            <button type="button" class="undo" onclick={onundo}>desfazer</button>
          {/if}
        </p>
      {/if}
    </div>
  </div>
</div>

<style>
  .sheet {
    display: grid;
    gap: 12px;
    min-width: 0;
    align-content: start;
  }
  div.sheet p {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink);
  }
  .home {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.875rem/1.1 var(--font-sans);
    cursor: pointer;
  }
  .pill[aria-pressed='true'] {
    border-color: var(--ink);
    background: var(--spark-soft);
    box-shadow: inset 0 0 0 1px var(--ink);
  }
  .card {
    display: grid;
    gap: 12px;
    padding: 18px 16px 16px;
    border-radius: 22px 22px 14px 14px;
    background: var(--surface);
    box-shadow: var(--shadow-e2);
  }
  div.sheet p.title {
    font: 600 1.25rem/1.25 var(--font-display);
    letter-spacing: -0.01em;
  }
  div.sheet p.desc {
    color: var(--ink-muted);
  }
  div.sheet p.desc.strong {
    color: var(--ink);
    font-weight: 600;
  }
  .field {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .label {
    padding: 0;
    font-size: 0.875rem;
    font-weight: 650;
    color: var(--ink);
  }
  div.sheet p.label {
    font-weight: 650;
  }
  .opt {
    font-weight: 400;
    color: var(--ink-muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.875rem/1 var(--font-sans);
    cursor: pointer;
  }
  .chip.on {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--on-primary);
  }
  .chip input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .chip:has(input:focus-visible) {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  textarea {
    width: 100%;
    min-height: 76px;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    background: var(--surface-sunken);
    color: var(--ink);
    font: 400 0.9375rem/1.4 var(--font-sans);
    resize: vertical;
  }
  textarea::placeholder {
    color: var(--ink-muted);
  }
  textarea:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  div.sheet p.helper {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .count {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .count.low {
    color: var(--warning);
    font-weight: 650;
  }
  .big {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 50px;
    border: 0;
    border-radius: 14px;
    background: var(--primary);
    color: var(--on-primary);
    font: 600 1rem/1 var(--font-sans);
    cursor: pointer;
  }
  .ghost,
  .sim,
  .undo {
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: var(--ink);
    font: 600 0.875rem/1.2 var(--font-sans);
    cursor: pointer;
    text-align: left;
  }
  .ghost {
    justify-self: start;
    margin-left: -12px;
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .sim {
    border: 1.5px dashed var(--line-strong);
    color: var(--ink-muted);
    text-align: center;
  }
  .sim:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .foot:empty {
    display: none;
  }
  .foot {
    display: grid;
    gap: 8px;
  }
  div.sheet p.toast {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 6px 6px 14px;
    border-radius: 12px;
    background: var(--ink);
    color: var(--bg);
  }
  .undo {
    flex: none;
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  div.sheet p.ended {
    padding: 8px 12px;
    border-radius: 12px;
    background: var(--success-soft);
    font-weight: 600;
  }
  button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .ico {
    flex: none;
    display: inline-block;
    width: 12px;
    height: 13px;
  }
  .ico.pause {
    background:
      linear-gradient(currentColor, currentColor) 0 0 / 35% 100% no-repeat,
      linear-gradient(currentColor, currentColor) 100% 0 / 35% 100% no-repeat;
  }
  .ico.fire {
    width: 10px;
    border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
    background: var(--warning);
  }
  .ico.play {
    background: currentColor;
    clip-path: polygon(10% 0, 100% 50%, 10% 100%);
  }
</style>
