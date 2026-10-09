<script lang="ts">
  import type { Line, Paper } from './ticket';

  // A strip of thermal paper with the ticket's lines on it: double height is stretched, double size
  // is doubled, rules are dashed, a pair is pushed to both edges, the way the printer draws them.
  // The paper is as wide as its millimetres (58 is 72,5% of 80) and the type is the same size on
  // both, like font A on a real printer: the narrow one just wraps sooner.
  let {
    lines,
    paper,
    edge = 'both',
    class: cls = '',
  }: {
    lines: Line[];
    paper: Paper;
    /** which ends are serrated; an end that's still in the printer has none */
    edge?: 'both' | 'top';
    class?: string;
  } = $props();
</script>

<div class="paper p{paper} {cls}" class:open-end={edge === 'top'}>
  {#each lines as l, i (i)}
    {#if l.kind === 'rule'}
      <span class="rule" aria-hidden="true"></span>
    {:else if l.kind === 'feed'}
      <span class="feed" aria-hidden="true"></span>
    {:else}
      <span
        class="ln {l.align}"
        class:b={l.bold}
        class:tall={l.h === 2 && l.w === 1}
        class:big={l.w === 2}
        style:padding-left={l.indent ? `${l.indent * 0.55}em` : undefined}
      >
        {#if l.kind === 'pair'}
          <span class="pair"><span>{l.text}</span><span>{l.right}</span></span>
        {:else}
          <span class="g">{l.text}</span>
        {/if}
      </span>
    {/if}
  {/each}
</div>

<style>
  .paper {
    --lh: 1.36em;
    --tooth: 10px;
    position: relative;
    display: grid;
    width: var(--w80);
    padding: calc(var(--tooth) + 0.9em) 5% calc(var(--tooth) + 1.4em);
    background: var(--surface);
    color: var(--sky-6);
    font-family: var(--font-sans);
    font-size: calc(var(--w80) * 0.0365);
    font-weight: 500;
    line-height: var(--lh);
    font-variant-numeric: tabular-nums;
    text-align: left;
    /* both ends serrated: each layer covers its half, its teeth on its edge */
    mask:
      conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / var(--tooth) 51%
        repeat-x,
      conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom /
        var(--tooth) 51% repeat-x;
  }
  .paper.open-end {
    padding-bottom: 1.4em;
    mask:
      conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / var(--tooth)
        calc(var(--tooth) + 1px) repeat-x,
      linear-gradient(#000, #000) bottom / 100% calc(100% - var(--tooth)) no-repeat;
  }
  /* 58 mm: 72,5% of the roll, 48 of its 58 mm printable (escpos.ts: 32 columns against 48) */
  .p58 {
    width: calc(var(--w80) * 0.725);
    padding-inline: calc(var(--w80) * 0.0625);
  }
  .p80 {
    padding-inline: calc(var(--w80) * 0.05);
  }

  .ln {
    display: block;
    min-height: var(--lh);
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .center {
    text-align: center;
  }
  .b {
    font-weight: 750;
  }
  /* double height: the glyph is stretched, the line takes two */
  .tall {
    min-height: calc(var(--lh) * 2);
  }
  .tall > .g {
    display: inline-block;
    transform: scaleY(1.85);
    transform-origin: 50% 0;
    padding-top: 0.08em;
  }
  /* double width and height */
  .big {
    font-size: 2em;
    line-height: var(--lh);
    min-height: 0;
    letter-spacing: 0.02em;
  }
  .pair {
    display: flex;
    justify-content: space-between;
    gap: 1ch;
  }
  .rule {
    display: block;
    height: var(--lh);
    background: linear-gradient(90deg, currentColor 55%, transparent 0) 0 50% / 0.55em 1.5px
      repeat-x;
  }
  .feed {
    display: block;
    height: var(--lh);
  }

  @media (prefers-color-scheme: dark) {
    .paper {
      /* paper stays paper at night, a touch dimmer than the page's light ink */
      background: color-mix(in srgb, var(--after-ink) 88%, var(--sky-5));
    }
  }
</style>
