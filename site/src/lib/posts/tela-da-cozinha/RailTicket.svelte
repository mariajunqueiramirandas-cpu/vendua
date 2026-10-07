<script lang="ts">
  import { WORD, clock, urgency } from './rules';

  // One paper ticket hanging from the rail, after the admin's Ticket.tsx: a fuse burning against the
  // prep time, the clock, the word, and a line of what's left or how late it is.
  let {
    number,
    name,
    items,
    acceptedAt,
    prep,
    rush,
    now,
  }: {
    number: number;
    name: string;
    items: string[];
    acceptedAt: number;
    prep: number;
    rush: boolean;
    now: number;
  } = $props();

  const waiting = $derived(now < acceptedAt);
  const elapsed = $derived(Math.max(0, now - acceptedAt));
  const u = $derived(urgency(elapsed, prep));
  const left = $derived(prep - elapsed);
  const fuse = $derived(Math.min(100, Math.max(4, (elapsed / prep) * 100)));
</script>

{#if waiting}
  <div class="stub ghost">
    <span class="clip" aria-hidden="true"></span>
    <p class="num tnum">#{number}</p>
    <p class="arrives">chega às {clock(acceptedAt)}</p>
  </div>
{:else}
  <article
    class="stub {u}"
    aria-label="Pedido {number}, {name}: {WORD[u]}{rush ? ', prioridade' : ''}"
  >
    <span class="clip" aria-hidden="true"></span>
    <span class="fuse" aria-hidden="true"><span style="width: {fuse}%"></span></span>
    <div class="head">
      <p class="num tnum">#{number}</p>
      <p class="who">{name}</p>
    </div>
    <p class="face tnum">{elapsed}:00</p>
    <p class="word">
      <span class="mark" aria-hidden="true"></span>{WORD[u]}
    </p>
    <p class="left tnum">
      {left > 0 ? `faltam ${left} min` : left === 0 ? 'deu o tempo' : `atrasado ${-left} min`}
    </p>
    {#if rush}<p class="rush">prioridade</p>{/if}
    <ul class="items">
      {#each items as i (i)}<li>{i}</li>{/each}
    </ul>
  </article>
{/if}

<style>
  .stub {
    --paper: var(--surface);
    position: relative;
    display: grid;
    align-content: start;
    gap: 2px;
    min-height: 100%;
    padding: 14px 10px 14px;
    background: var(--paper);
    border-radius: 3px 3px 0 0;
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-e1);
    transform-origin: 50% 0;
  }
  /* the torn bottom edge of a till roll */
  .stub::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -7px;
    height: 7px;
    background:
      linear-gradient(135deg, var(--paper) 50%, transparent 50%) 0 0 / 10px 7px repeat-x,
      linear-gradient(225deg, var(--paper) 50%, transparent 50%) 0 0 / 10px 7px repeat-x;
  }
  .stub:nth-child(2n) {
    rotate: 0.8deg;
  }
  .stub:nth-child(3n) {
    rotate: -0.6deg;
  }
  .clip {
    position: absolute;
    top: -12px;
    left: 50%;
    width: 22px;
    height: 16px;
    translate: -50% 0;
    border-radius: 4px 4px 2px 2px;
    background: var(--ink-faint);
  }
  .ghost {
    --paper: transparent;
    box-shadow: none;
    outline: 1.5px dashed var(--line-strong);
    outline-offset: -1.5px;
    color: var(--ink-muted);
    justify-items: center;
    align-content: center;
    text-align: center;
  }
  .ghost::after {
    display: none;
  }
  .ghost p.arrives {
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--ink-muted);
  }

  .fuse {
    display: block;
    height: 6px;
    margin: 0 -10px 8px;
    background: var(--surface-sunken);
  }
  .fuse span {
    display: block;
    height: 100%;
    background: var(--success);
    transition: width var(--duration-smooth) var(--ease-soft);
  }
  .warn .fuse span {
    background: var(--warning);
  }
  .late .fuse span {
    background: repeating-linear-gradient(
      -45deg,
      var(--danger) 0 6px,
      color-mix(in srgb, var(--danger) 55%, var(--paper)) 6px 12px
    );
  }
  .warn {
    --paper: color-mix(in srgb, var(--warning-soft) 70%, var(--surface));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--warning) 45%, transparent),
      var(--shadow-e1);
  }
  .late {
    --paper: color-mix(in srgb, var(--danger-soft) 70%, var(--surface));
    box-shadow:
      0 0 0 2px var(--danger),
      var(--shadow-e1);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px;
    flex-wrap: wrap;
  }
  article.stub p,
  div.ghost p {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--ink);
  }
  article p.num,
  .ghost p.num {
    font: 700 1.25rem/1.1 var(--font-display);
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .ghost p.num {
    color: var(--ink-muted);
  }
  article p.who {
    font-weight: 600;
    color: var(--ink-muted);
  }
  article p.face {
    margin-top: 4px;
    font: 600 1.5rem/1 var(--font-display);
    letter-spacing: -0.02em;
  }
  article p.word {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 6px;
    font-weight: 700;
    color: var(--success);
  }
  .warn p.word {
    color: var(--warning);
  }
  .late p.word {
    color: var(--danger);
  }
  /* shape too, never colour alone: a dot, a triangle, a square */
  .mark {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: currentColor;
  }
  .warn .mark {
    border-radius: 0;
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
  }
  .late .mark {
    border-radius: 1px;
  }
  article p.left {
    color: var(--ink-muted);
  }
  article p.rush {
    justify-self: start;
    margin-top: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--surface);
    font-weight: 700;
    font-size: 0.75rem;
  }
  article ul.items {
    display: grid;
    gap: 2px;
    margin: 8px 0 0;
    padding: 8px 0 0;
    border-top: 1px dashed var(--line-strong);
    list-style: none;
  }
  article ul.items li {
    font-size: 0.75rem;
    line-height: 1.35;
    color: var(--ink);
  }

  @media (min-width: 560px) {
    .stub {
      padding-inline: 14px;
    }
    .fuse {
      margin-inline: -14px;
    }
    article p.face {
      font-size: 1.875rem;
    }
    article ul.items li {
      font-size: 0.8125rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fuse span {
      transition: none;
    }
  }
</style>
