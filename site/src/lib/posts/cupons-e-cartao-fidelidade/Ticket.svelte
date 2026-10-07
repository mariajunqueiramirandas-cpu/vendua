<script lang="ts">
  // A coupon drawn as a paper ticket: scalloped short edges, a perforation before the stub, and the
  // two half-moon cuts where the perforation meets the edges. The cuts are painted in `--paper`, the
  // colour of whatever the ticket sits on, so the parent sets it.
  let {
    big,
    small,
    code,
    codeLabel = 'código',
    lines = [],
    off = null,
  }: {
    big: string;
    small: string;
    code: string;
    codeLabel?: string;
    lines?: string[];
    /** why it doesn't apply: shown as a stamp across the ticket */
    off?: string | null;
  } = $props();
</script>

<div class="ticket" class:off={!!off}>
  <div class="main">
    <p class="big">{big}</p>
    <p class="small">{small}</p>
    {#if lines.length}
      <ul class="lines">
        {#each lines as l (l)}
          <li>{l}</li>
        {/each}
      </ul>
    {/if}
  </div>
  <div class="stub">
    <p class="code">{code || '...'}</p>
    <p class="code-label">{codeLabel}</p>
  </div>
  {#if off}
    <p class="stamp">{off}</p>
  {/if}
</div>

<style>
  .ticket {
    --notch: 11px;
    --scallop: 5px;
    --face: var(--spark);
    --face-ink: var(--on-spark);
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) fit-content(48%);
    min-height: 132px;
    border-radius: 6px;
    background: var(--face);
    color: var(--face-ink);
    transition:
      background var(--duration-smooth) var(--ease-soft),
      color var(--duration-smooth) var(--ease-soft);
  }
  /* the scalloped short edges, bitten out in the paper's colour */
  .ticket::before,
  .ticket::after {
    content: '';
    position: absolute;
    top: 6px;
    bottom: 6px;
    width: calc(var(--scallop) * 2);
    background: radial-gradient(
        circle,
        var(--paper) var(--scallop),
        transparent calc(var(--scallop) + 0.5px)
      )
      0 0 / 100% calc(var(--scallop) * 3) repeat-y;
  }
  .ticket::before {
    left: calc(var(--scallop) * -1);
  }
  .ticket::after {
    right: calc(var(--scallop) * -1);
  }
  .off {
    --face: color-mix(in srgb, var(--ink) 8%, var(--paper));
    --face-ink: var(--ink-muted);
  }

  .main {
    display: grid;
    align-content: center;
    gap: 2px;
    min-width: 0;
    padding: 16px 14px 16px 24px;
  }
  .ticket p.big {
    font: 600 clamp(2rem, 1.4rem + 3vw, 2.75rem) / 1 var(--font-display);
    letter-spacing: -0.03em;
    color: inherit;
    font-variant-numeric: tabular-nums;
  }
  .ticket p.small {
    font-size: 0.9375rem;
    line-height: 1.35;
    font-weight: 600;
    color: inherit;
  }
  .ticket ul.lines {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }
  .ticket ul.lines li {
    padding: 2px 8px;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
    border-radius: 999px;
    font-size: 0.8125rem;
    line-height: 1.35;
    font-weight: 600;
    color: inherit;
  }

  .stub {
    position: relative;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 4px;
    min-width: 96px;
    padding: 14px 18px 14px 14px;
    border-left: 2px dashed color-mix(in srgb, currentColor 40%, transparent);
    text-align: center;
  }
  /* the half-moon cuts where the perforation meets the long edges */
  .stub::before,
  .stub::after {
    content: '';
    position: absolute;
    left: calc(var(--notch) * -1 - 1px);
    width: calc(var(--notch) * 2);
    height: calc(var(--notch) * 2);
    border-radius: 50%;
    background: var(--paper);
  }
  .stub::before {
    top: calc(var(--notch) * -1);
  }
  .stub::after {
    bottom: calc(var(--notch) * -1);
  }
  .ticket p.code {
    font: 700 clamp(0.9375rem, 0.8rem + 0.6vw, 1.0625rem) / 1.2 var(--font-display);
    letter-spacing: 0.03em;
    overflow-wrap: anywhere;
    color: inherit;
  }
  .ticket p.code-label {
    font-size: 0.8125rem;
    line-height: 1.2;
    color: inherit;
  }

  .ticket p.stamp {
    position: absolute;
    top: 50%;
    left: 50%;
    max-width: 80%;
    padding: 4px 10px;
    border: 2.5px solid var(--danger);
    border-radius: 6px;
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    box-shadow: var(--shadow-e1);
    color: var(--danger);
    font: 700 0.9375rem/1.25 var(--font-display);
    text-align: center;
    transform: translate(-50%, -50%) rotate(-7deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .ticket {
      transition: none;
    }
  }
</style>
