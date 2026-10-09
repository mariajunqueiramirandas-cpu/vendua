<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { COUNTS, LINK, SOURCE, STATIONS } from './nena';
  import { readableNames } from './platforms';
  import Preview from './Preview.svelte';

  // Before hydration (and without JavaScript) the belt is finished and the preview is open; once
  // live, it waits at the start for the visitor's "Ler o cardápio".
  let { live, reduced }: { live: boolean; reduced: boolean } = $props();

  type Phase = 'idle' | 'reading' | 'preview' | 'done';
  const N = STATIONS.length;
  let phase = $state<Phase>(untrack(() => live) ? 'idle' : 'preview');
  let k = $state(untrack(() => live) ? 0 : N);
  let photos = $state(0);
  let out: HTMLDivElement | undefined = $state();
  let armed = untrack(() => live);
  const timers: ReturnType<typeof setTimeout>[] = [];

  $effect(() => {
    if (live && !armed) {
      armed = true;
      phase = 'idle';
      k = 0;
    }
  });
  $effect(() => () => timers.forEach(clearTimeout));

  async function showPreview() {
    phase = 'preview';
    await tick();
    out?.focus({ preventScroll: reduced });
  }

  function read() {
    phase = 'reading';
    k = 0;
    if (reduced) {
      k = N;
      void showPreview();
      return;
    }
    STATIONS.forEach((_, i) => timers.push(setTimeout(() => (k = i + 1), 480 * (i + 1))));
    timers.push(setTimeout(showPreview, 480 * N + 400));
  }

  function importIt() {
    phase = 'done';
    photos = 0;
    if (reduced) {
      photos = COUNTS.photos;
      return;
    }
    for (let i = 1; i <= COUNTS.photos; i++)
      timers.push(setTimeout(() => (photos = i), 500 + i * 170));
  }

  const status = $derived(
    phase === 'idle'
      ? `Lemos lojas do ${readableNames()}. Nada muda na sua loja até você tocar em “Importar”.`
      : phase === 'reading'
        ? `Lendo o cardápio no ${SOURCE}… Leva alguns segundos.`
        : phase === 'preview'
          ? 'Leitura pronta. A prévia está logo abaixo.'
          : 'Importado.',
  );
</script>

<div class="belt">
  <div class="intake">
    <span class="pill">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
        />
      </svg>
      <span class="url">{LINK}</span>
    </span>
    {#if live && phase === 'idle'}
      <button type="button" class="read" onclick={read}>Ler o cardápio</button>
    {/if}
  </div>

  <p class="status" role="status">{status}</p>

  <ol class="stations" class:moving={phase === 'reading'} aria-label="O que a Venduá lê">
    {#each STATIONS as s, i (s.id)}
      {@const done = i < k}
      {@const now = phase === 'reading' && i === k}
      <li class:done class:now>
        <span class="dot" aria-hidden="true">
          {#if done}<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" /></svg>{/if}
        </span>
        <span class="label">{s.label}</span>
        <span class="found">
          {#if done}{s.found}{:else if now}lendo…{:else}<span class="sr">ainda não</span>{/if}
        </span>
      </li>
    {/each}
  </ol>

  <div class="out" tabindex="-1" bind:this={out} aria-label="Prévia da importação">
    {#if phase === 'preview' || phase === 'done'}
      <Preview done={phase === 'done'} {photos} onimport={live ? importIt : undefined} />
    {:else}
      <p class="wait">A prévia aparece aqui.</p>
    {/if}
  </div>
</div>

<style>
  .belt {
    display: grid;
    gap: 14px;
    width: 100%;
  }
  .intake {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    min-height: 48px;
    padding: 0 16px 0 12px;
    border-radius: 999px;
    background: var(--surface);
    border: 1.5px solid var(--ink);
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--ink);
  }
  .pill svg {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .read {
    min-height: 48px;
    padding: 0 20px;
    border: 0;
    border-radius: 999px;
    background: var(--spark);
    color: var(--on-spark);
    font-weight: 700;
    cursor: pointer;
  }
  .read:hover {
    filter: brightness(0.96);
  }
  .belt p.status {
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }

  /* the belt: a slatted track down the left, one stop per thing the import reads */
  .belt ol.stations {
    position: relative;
    display: grid;
    margin: 0;
    padding: 0 0 0 4px;
    list-style: none;
  }
  .stations::before {
    content: '';
    position: absolute;
    left: 13px;
    top: 10px;
    bottom: 10px;
    width: 14px;
    border-radius: 999px;
    background:
      repeating-linear-gradient(180deg, var(--line-strong) 0 3px, transparent 3px 11px),
      var(--surface);
    border: 1px solid var(--line-strong);
  }
  .stations.moving::before {
    animation: slats 0.6s linear infinite;
  }
  @keyframes slats {
    to {
      background-position:
        0 11px,
        0 0;
    }
  }
  .belt .stations li {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-height: 40px;
    font-size: 0.9375rem;
    line-height: 1.3;
    color: var(--ink-muted);
  }
  .dot {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-left: 2px;
    border-radius: 50%;
    background: var(--surface);
    border: 2px solid var(--line-strong);
    transition:
      background var(--duration-quick) var(--ease-soft),
      transform var(--duration-smooth) var(--ease-soft);
  }
  .dot svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--surface);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .belt li.done .dot {
    background: var(--success);
    border-color: var(--success);
  }
  .belt li.now .dot {
    background: var(--spark);
    border-color: var(--ink);
    transform: scale(1.12);
  }
  .belt li.done,
  .belt li.now {
    color: var(--ink);
  }
  .label {
    font-weight: 600;
  }
  .found {
    text-align: right;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }
  .belt li.done .found {
    font-weight: 600;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .out {
    border-radius: var(--radius-md);
  }
  .out:focus-visible {
    outline-offset: 4px;
  }
  .out:focus:not(:focus-visible) {
    outline: none;
  }
  .belt p.wait {
    display: grid;
    place-items: center;
    min-height: 120px;
    border-radius: var(--radius-md);
    border: 2px dashed var(--line-strong);
    font-size: 0.9375rem;
    color: var(--ink-muted);
  }

  @media (max-width: 420px) {
    .belt .stations li {
      grid-template-columns: 32px minmax(0, 1fr);
      gap: 0 10px;
      padding-block: 4px;
    }
    .found {
      grid-column: 2;
      text-align: left;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stations.moving::before {
      animation: none;
    }
    .dot {
      transition: none;
    }
  }
</style>
