<script lang="ts">
  import Folha from './Folha.svelte';
  import Vitrine from './Vitrine.svelte';
  import { DAY, dayName, hhmm, spanEnd, statusAt, when, type DemandSpan, type Span } from './rules';

  // The owner's sheet and the shop's door side by side: what Nena chooses, and what a shopper
  // sees on the store at that moment. Saturday 13:30, the week of NENA_HOURS. Before "pausar agora"
  // the door shows the sheet's own preview ("Como fica na loja"), then the store itself.
  const T0 = 6 * DAY + 13 * 60 + 30;

  let { reduced }: { reduced: boolean } = $props();

  let mode = $state<'pause' | 'demand'>('pause');
  let span = $state<Span>('1h');
  let message = $state('Fornada nova saindo do forno! Voltamos às 14h30 com bolo quentinho.');
  let now = $state(T0);
  let pausedUntil = $state<number | null | undefined>(undefined);
  let demandUntil = $state<number | null>(null);
  let toast = $state<{ text: string; undo: boolean } | null>(null);
  let ended = $state<string | null>(null);
  let running = $state(false);
  let raf = 0;
  // the door shows the sheet's preview while Nena is choosing; after a pause ends or she comes
  // back, it shows the store itself until she touches the sheet again
  let previewing = $state(true);
  $effect(() => {
    void span;
    void message;
    void mode;
    previewing = true;
    ended = null;
  });

  const demandOn = $derived(demandUntil !== null && demandUntil > now);
  const preview = $derived(mode === 'pause' && pausedUntil === undefined && previewing);
  const status = $derived(statusAt(now, [], preview ? spanEnd(span, now) : pausedUntil));
  const label = $derived(
    preview
      ? 'Como fica na loja quando você pausar'
      : mode === 'demand' && !demandOn && pausedUntil === undefined
        ? 'Como fica na loja com o aviso ligado'
        : `Na loja agora, ${dayName(now)} ${hhmm(now)}`,
  );

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    running = false;
  }

  function pause() {
    stop();
    ended = null;
    pausedUntil = spanEnd(span, now);
    toast = { text: 'Loja pausada. Ninguém consegue pedir até você voltar.', undo: true };
  }

  function resume() {
    stop();
    pausedUntil = undefined;
    previewing = false;
    ended = null;
    toast = {
      text:
        statusAt(now, []).kind === 'open'
          ? 'Loja aberta de novo'
          : 'Pausa encerrada. A loja segue o horário normal.',
      undo: false,
    };
  }

  function demand(s: DemandSpan | 'off') {
    ended = null;
    if (s === 'off') {
      demandUntil = null;
      toast = { text: 'Aviso de muitos pedidos desligado.', undo: false };
      return;
    }
    const wasOn = demandOn;
    demandUntil = spanEnd(s, now);
    toast = {
      text: `Aviso de muitos pedidos até ${when(demandUntil!, now)}.`,
      undo: !wasOn,
    };
  }

  function undo() {
    if (toast?.text.startsWith('Loja pausada')) {
      pausedUntil = undefined;
      previewing = true;
    } else demandUntil = null;
    toast = null;
  }

  /** a simulation control: the clock runs to the moment the pause or the warning ends */
  function fastForward(to: number) {
    stop();
    toast = null;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = now;
    const finish = () => {
      now = to;
      running = false;
      raf = 0;
      if (pausedUntil !== undefined && pausedUntil !== null && pausedUntil <= now) {
        pausedUntil = undefined;
        previewing = false;
        const st = statusAt(now, []);
        ended =
          st.kind === 'open'
            ? `${hhmm(now)}: a pausa acabou sozinha e a loja voltou a vender.`
            : `${hhmm(now)}: a pausa acabou sozinha. Fora do horário, a loja fica fechada até abrir.`;
      } else if (demandUntil !== null && demandUntil <= now) {
        demandUntil = null;
        ended = `${hhmm(now)}: o aviso de muitos pedidos desligou sozinho.`;
      }
    };
    if (reduced || to - from <= 0) return finish();
    running = true;
    const ms = Math.min(2600, 900 + (to - from) * 12);
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      now = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(tick);
      else finish();
    };
    raf = requestAnimationFrame(tick);
  }

  $effect(() => stop);
</script>

<div class="split">
  <div class="side">
    <p class="who">No celular da Nena</p>
    <Folha
      bind:mode
      bind:span
      bind:message
      {now}
      {pausedUntil}
      {demandUntil}
      {toast}
      {ended}
      {running}
      onpause={pause}
      onresume={resume}
      onundo={undo}
      ondemand={demand}
      onfastforward={fastForward}
    />
  </div>
  <div class="side">
    <p class="who">Na porta da loja</p>
    <Vitrine
      {status}
      {now}
      message={preview || pausedUntil !== undefined ? message : ''}
      demand={demandOn || (mode === 'demand' && pausedUntil === undefined)}
      {label}
      {reduced}
    />
  </div>
</div>

<style>
  .split {
    display: grid;
    gap: 22px;
    width: 100%;
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    display: grid;
    gap: 10px;
    align-content: start;
    min-width: 0;
  }
  div.side p.who {
    margin: 0;
    font: 600 1rem/1.3 var(--font-display);
    color: var(--ink);
  }
  @media (min-width: 600px) {
    .split {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
</style>
