<script lang="ts">
  // The sign hanging on the shop's door: the store's status word, flipped like a real sign when it
  // changes. The shape says it too (dot, pause bars, ring), never the colour alone.
  let {
    word,
    rest = '',
    tag = null,
    size = 'md',
    reduced = false,
  }: {
    word: 'Aberto' | 'Pausado' | 'Fechado';
    rest?: string;
    /** a smaller card clipped under the sign ("Muitos pedidos agora") */
    tag?: string | null;
    /** xs: the shape alone, for a table's header (the word goes beside it) */
    size?: 'xs' | 'sm' | 'md';
    reduced?: boolean;
  } = $props();

  const tone = $derived(word === 'Aberto' ? 'open' : word === 'Pausado' ? 'paused' : 'closed');

  // only a change swings the sign: the page loads with it hanging still
  let moved = $state(false);
  let tagMoved = $state(false);
  let seen = { word: '', tag: null as string | null, first: true };
  $effect(() => {
    if (seen.first) seen = { word, tag, first: false };
    if (word !== seen.word) moved = true;
    if (tag !== seen.tag) tagMoved = true;
    seen = { word, tag, first: false };
  });
</script>

<div class="placa {size}" class:still={reduced} class:moved class:tag-moved={tagMoved}>
  <svg class="cord" viewBox="0 0 100 34" aria-hidden="true" preserveAspectRatio="none">
    <path d="M8 34 L50 4 L92 34" />
    <circle cx="50" cy="4" r="3.4" />
  </svg>
  {#key word}
    <div class="board {tone}" role="img" aria-label={`${word}${rest ? ` ${rest}` : ''}`}>
      <span class="glyph" aria-hidden="true"></span>
      {#if size !== 'xs'}
        <span class="words">
          <span class="word">{word}</span>
          {#if rest}<span class="rest">{rest}</span>{/if}
        </span>
      {/if}
    </div>
  {/key}
  {#if tag}
    <div
      class="tag"
      role={size === 'xs' ? 'img' : undefined}
      aria-label={size === 'xs' ? tag : undefined}
    >
      <span class="hook" aria-hidden="true"></span>
      <span class="flame" aria-hidden="true"></span>{size === 'xs' ? '' : tag}
    </div>
  {/if}
</div>

<style>
  .placa {
    display: grid;
    justify-items: center;
    width: 100%;
    max-width: 15rem;
    margin-inline: auto;
    perspective: 600px;
  }
  .placa.sm {
    max-width: 10.5rem;
  }
  .placa.xs {
    width: auto;
    max-width: none;
  }
  .xs .cord {
    width: 34px;
    height: 12px;
  }
  .xs .board {
    width: auto;
    padding: 6px 9px;
    border-radius: 7px;
    border-width: 1.5px;
  }
  .xs .tag {
    margin-top: 6px;
    padding: 3px 5px;
  }
  .xs .hook {
    top: -7px;
    height: 6px;
  }
  .cord {
    display: block;
    width: 62%;
    height: 26px;
    margin-bottom: -2px;
    overflow: visible;
  }
  .sm .cord {
    height: 18px;
  }
  .cord path {
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 1.6;
    vector-effect: non-scaling-stroke;
  }
  .cord circle {
    fill: var(--ink);
  }
  .board {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    border: 2px solid var(--ink);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-e1);
    transform-origin: 50% 0;
  }
  .moved .board {
    animation: swing 640ms var(--ease-soft);
  }
  .sm .board {
    gap: 7px;
    padding: 6px 9px;
    border-radius: 9px;
  }
  .still .board,
  .still .tag {
    animation: none !important;
  }
  @keyframes swing {
    0% {
      transform: rotateY(-90deg) rotateZ(0deg);
    }
    45% {
      transform: rotateY(0deg) rotateZ(-4deg);
    }
    75% {
      transform: rotateZ(2deg);
    }
    100% {
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .moved .board,
    .tag-moved .tag {
      animation: none;
    }
  }
  .words {
    display: grid;
    min-width: 0;
  }
  .word {
    font: 600 1.5rem/1.05 var(--font-display);
    letter-spacing: -0.02em;
  }
  .sm .word {
    font-size: 1.0625rem;
  }
  .rest {
    margin-top: 2px;
    font-size: 0.875rem;
    line-height: 1.25;
    font-weight: 600;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .sm .rest {
    font-size: 0.75rem;
  }
  .glyph {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
  }
  .sm .glyph {
    width: 10px;
    height: 10px;
  }
  .open .glyph {
    background: var(--success);
    box-shadow: 0 0 0 4px var(--success-soft);
  }
  .paused .glyph {
    border-radius: 2px;
    background:
      linear-gradient(var(--warning), var(--warning)) 0 0 / 35% 100% no-repeat,
      linear-gradient(var(--warning), var(--warning)) 100% 0 / 35% 100% no-repeat;
  }
  .paused {
    background: var(--warning-soft);
  }
  .closed .glyph {
    border: 3px solid var(--ink-muted);
  }
  .sm .closed .glyph {
    border-width: 2px;
  }
  .closed {
    background: var(--surface-sunken);
  }
  .tag {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    padding: 5px 11px;
    border-radius: 8px;
    background: var(--warning-soft);
    border: 1.5px solid var(--warning);
    color: var(--ink);
    font-size: 0.8125rem;
    font-weight: 650;
    line-height: 1.3;
    transform-origin: 50% -12px;
  }
  .tag-moved .tag {
    animation: dangle 520ms var(--ease-soft);
  }
  @keyframes dangle {
    0% {
      transform: rotate(-9deg);
      opacity: 0;
    }
    60% {
      transform: rotate(3deg);
      opacity: 1;
    }
    100% {
      transform: none;
    }
  }
  .hook {
    position: absolute;
    top: -13px;
    left: 50%;
    width: 1.5px;
    height: 12px;
    background: var(--ink-muted);
  }
  .flame {
    width: 9px;
    height: 12px;
    border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
    background: var(--warning);
  }
</style>
