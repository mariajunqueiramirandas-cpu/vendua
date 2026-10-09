<script lang="ts">
  import { WARN_AT, clock } from './rules';

  // Each order as a fuse from "aceitar" to 19h: green until 60% of its prep time, amber until 100%,
  // striped red after. The line is the hour you dragged to; what's right of it hasn't happened yet.
  let {
    orders,
    now,
    chips,
    onPrep,
    live,
  }: {
    orders: { number: number; name: string; acceptedAt: number; prep: number }[];
    now: number;
    chips: number[];
    onPrep: (number: number, minutes: number) => void;
    live: boolean;
  } = $props();

  const pct = (m: number) => `${(Math.min(60, Math.max(0, m)) / 60) * 100}%`;
  const ticks = [0, 15, 30, 45, 60];

  function rows() {
    return orders.map((o) => {
      const warn = o.acceptedAt + Math.round(o.prep * WARN_AT * 10) / 10;
      const late = o.acceptedAt + o.prep;
      return { ...o, warn, late };
    });
  }
  const list = $derived(rows());
</script>

<div class="tl">
  {#each list as o (o.number)}
    <div class="row">
      <div class="rh">
        <p class="who"><strong>#{o.number} {o.name}</strong>, aceito às {clock(o.acceptedAt)}</p>
        <div class="chips" role="radiogroup" aria-label="tempo de preparo do #{o.number}">
          {#each chips as m (m)}
            <button
              type="button"
              role="radio"
              aria-checked={o.prep === m}
              aria-label="{m} minutos"
              disabled={!live}
              onclick={() => onPrep(o.number, m)}><span class="tnum">{m}</span></button
            >
          {/each}
          <span class="min" aria-hidden="true">min</span>
        </div>
      </div>
      <p class="sr-only">
        #{o.number}: no tempo até {clock(Math.floor(o.warn))}, atenção até {clock(o.late)}, atrasado
        depois.
      </p>
      <div class="track" aria-hidden="true">
        <span
          class="seg fresh"
          style="left: {pct(o.acceptedAt)}; width: calc({pct(o.warn)} - {pct(o.acceptedAt)})"
          >{#if o.warn - o.acceptedAt >= 12}<b>no tempo</b>{/if}</span
        >
        <span
          class="seg warn"
          style="left: {pct(o.warn)}; width: calc({pct(o.late)} - {pct(o.warn)})"
          >{#if o.late - o.warn >= 11}<b>atenção</b>{/if}</span
        >
        <span class="seg late" style="left: {pct(o.late)}; right: 0"
          >{#if 60 - o.late >= 12}<b>atrasado</b>{/if}</span
        >
        <span class="future" style="left: {pct(now)}"></span>
        <span class="cursor" style="left: {pct(now)}"></span>
      </div>
      <div class="marks" aria-hidden="true">
        <span class="mk right tnum" style="left: {pct(o.warn)}">{clock(Math.floor(o.warn))}</span>
        <span class="mk tnum" class:right={o.late > 48} style="left: {pct(o.late)}"
          >{clock(o.late)}</span
        >
      </div>
    </div>
  {/each}
  <div class="axis" aria-hidden="true">
    {#each ticks as t (t)}
      <span class="tick tnum" class:first={t === 0} class:last={t === 60} style="left: {pct(t)}"
        >{clock(t)}</span
      >
    {/each}
  </div>
</div>

<style>
  .tl {
    display: grid;
    gap: 16px;
    padding: 16px 14px 12px;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--line);
  }
  .row {
    display: grid;
    gap: 6px;
  }
  .rh {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
  }
  .tl p.who {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .tl p.who strong {
    color: var(--ink);
  }
  .chips {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .chips button {
    display: grid;
    place-items: center;
    min-width: 44px;
    height: 44px;
    padding: 0 6px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    color: var(--ink);
    font: 700 1rem var(--font-display);
    cursor: pointer;
  }
  .chips button[aria-checked='true'] {
    background: var(--primary);
    color: var(--on-primary);
  }
  .chips button:disabled {
    cursor: default;
  }
  .chips button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .min {
    margin-left: 2px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink-muted);
  }

  .track {
    position: relative;
    height: 30px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface-sunken);
  }
  .seg {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    padding-left: 7px;
    overflow: hidden;
    white-space: nowrap;
    font-size: 0.75rem;
    font-weight: 700;
    transition:
      left var(--duration-smooth) var(--ease-soft),
      width var(--duration-smooth) var(--ease-soft);
  }
  .seg b {
    position: relative;
    z-index: 2;
    font-weight: 700;
  }
  .fresh {
    background: var(--success-soft);
    color: var(--success);
    box-shadow: inset 3px 0 0 var(--success);
  }
  .warn {
    background: var(--warning-soft);
    color: var(--warning);
    box-shadow: inset 2px 0 0 var(--warning);
  }
  .late {
    background: repeating-linear-gradient(
      -45deg,
      var(--danger-soft) 0 7px,
      color-mix(in srgb, var(--danger) 22%, var(--surface)) 7px 14px
    );
    color: var(--danger);
    box-shadow: inset 2px 0 0 var(--danger);
  }
  .future {
    position: absolute;
    z-index: 1;
    top: 0;
    bottom: 0;
    right: 0;
    background: color-mix(in srgb, var(--surface) 55%, transparent);
  }
  .cursor {
    position: absolute;
    z-index: 3;
    top: 0;
    bottom: 0;
    width: 2px;
    translate: -1px 0;
    background: var(--ink);
  }
  .marks {
    position: relative;
    height: 16px;
  }
  .mk,
  .tick {
    position: absolute;
    top: 0;
    font-size: 0.75rem;
    line-height: 16px;
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .mk {
    padding-left: 4px;
    border-left: 1.5px solid var(--line-strong);
  }
  .mk.right {
    translate: -100% 0;
    padding: 0 4px 0 0;
    border-left: 0;
    border-right: 1.5px solid var(--line-strong);
  }
  .axis {
    position: relative;
    height: 18px;
    margin-top: -4px;
    border-top: 1px solid var(--line);
  }
  .tick {
    top: 3px;
    translate: -50% 0;
  }
  .tick.first {
    translate: 0 0;
  }
  .tick.last {
    translate: -100% 0;
  }

  @media (min-width: 560px) {
    .tl {
      padding: 18px 20px 14px;
    }
    .seg {
      font-size: 0.8125rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .seg {
      transition: none;
    }
  }
</style>
