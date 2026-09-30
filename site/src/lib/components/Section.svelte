<script lang="ts">
  import type { Snippet } from 'svelte';

  // One stop of the store's day. `sky` is the section's background (run it from one --sky-N stop to the
  // next so sections join without a seam); `tone="after"` is for dusk and night, where text stays light
  // in both themes. `hour` ("6h") names the moment: the hour in the moment serif, standing on a small
  // horizon where the sun has got to along the day's arc (gone by 21h, when the moon is up). `overlay`
  // is for the first section, which runs up under the sticky header: its content and mark start below it.
  // data-tone (+ where the sunset band turns dark) lets the header's glass follow the sky under it.
  let {
    id,
    sky,
    tone = 'day',
    hour,
    label,
    labelledby,
    overlay = false,
    class: cls = '',
    children,
  }: {
    id?: string;
    sky: string;
    tone?: 'day' | 'after';
    hour?: string;
    label?: string;
    labelledby?: string;
    overlay?: boolean;
    class?: string;
    children: Snippet;
  } = $props();

  // 0° is sunrise at the left end of the horizon, 180° sunset at the right. By day the arc is lit as far
  // as the sun has got (scrolling in from 40° back); after sunset the moon rides the same arc.
  const deg = $derived(hour ? (parseInt(hour) - 6) * 15 : 0);
  const night = $derived(deg > 180);
  const at = $derived(night ? deg - 180 : Math.max(deg, 0));
  const lit = $derived(night ? 0 : Math.min(at, 180));
  const vars = $derived(`--at: ${at}deg; --off: ${180 - lit}; --off0: ${Math.min(180, 220 - lit)}`);
</script>

<section
  {id}
  class="section {tone} {cls}"
  class:overlay
  style="background: {sky}"
  data-tone={tone}
  data-dark-from={sky.includes('--sunset') ? 240 : undefined}
  aria-label={label}
  aria-labelledby={labelledby}
>
  <div class="wrap inner">
    {#if hour}
      <span class="hour" aria-hidden="true" style={vars}>
        <svg viewBox="0 0 64 34.2">
          <path class="lit" d="M10 33a22 22 0 0 1 44 0" pathLength="180" />
          <path class="path" d="M10 33a22 22 0 0 1 44 0" />
          {#if night}
            <g class="moon">
              <circle cx="10" cy="33" r="7.4" />
              <path d="M11.6 27.84a5.4 5.4 0 1 0 0 10.32 6 6 0 0 1 0-10.32z" />
            </g>
            <path class="stars" d="M45 6.5v6M42 9.5h6M55 14.5v4M53 16.5h4" />
          {:else}
            <g class="sun">
              <path
                class="rays"
                d="M16.47 35.68 18.5 36.52M12.68 39.47 13.52 41.5M7.32 39.47 6.48 41.5M3.53 35.68 1.5 36.52M3.53 30.32 1.5 29.48M7.32 26.53 6.48 24.5M12.68 26.53 13.52 24.5M16.47 30.32 18.5 29.48"
              />
              <circle cx="10" cy="33" r="4.6" />
            </g>
          {/if}
          <path class="ground" d="M1.5 33.1c20-.9 41-.9 61 0" />
        </svg>
        <b>{hour}</b>
      </span>
    {/if}
    {@render children()}
  </div>
</section>

<style>
  .section {
    position: relative;
    isolation: isolate;
    overflow: clip;
    color: var(--ink);
  }
  .inner {
    position: relative;
    padding-block: clamp(64px, 9vw, 128px);
  }
  .overlay {
    --under-header: calc(var(--header-h) + env(safe-area-inset-top, 0px));
  }
  .overlay > .inner {
    padding-top: calc(clamp(56px, 7vw, 96px) + var(--under-header));
  }
  .after {
    --ink: var(--after-ink);
    --ink-muted: var(--after-muted);
    --line: var(--after-line);
    --surface: var(--after-card);
    color: var(--after-ink);
  }
  .hour {
    position: absolute;
    top: clamp(20px, 3vw, 32px);
    left: var(--gutter);
    display: inline-flex;
    align-items: baseline;
    gap: 7px;
    color: var(--ink);
  }
  .overlay .hour {
    top: calc(var(--under-header) + 4px);
  }
  /* dusk starts on the sunset's gold in Creme, so the mark keeps the day's ink there; in Noite the band
     is already dark */
  .after[data-dark-from] .hour {
    color: #123c32;
  }
  @media (prefers-color-scheme: dark) {
    .after[data-dark-from] .hour {
      color: var(--after-ink);
    }
  }
  .hour b {
    font: italic 400 1.75rem/1 var(--font-moment);
    letter-spacing: -0.01em;
  }
  .hour svg {
    width: 52px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @media (min-width: 768px) {
    .hour svg {
      width: 62px;
    }
    .hour b {
      font-size: 2.0625rem;
    }
  }
  .path {
    stroke-width: 1.8;
    stroke-dasharray: 0 4.4;
  }
  /* the lime highlighter trails the sun, under the inked path */
  .lit {
    stroke: var(--spark);
    stroke-width: 4.6;
    stroke-dasharray: 180 180;
    stroke-dashoffset: var(--off);
  }
  .sun,
  .moon {
    transform-box: view-box;
    transform-origin: 32px 33px;
    transform: rotate(var(--at));
  }
  /* a gap in the arc around the crescent: the night sky is the same colour in both themes */
  .moon circle {
    fill: var(--sky-5);
    stroke: none;
  }
  .sun circle,
  .moon path {
    fill: var(--spark);
    stroke-width: 1.8;
  }
  .rays,
  .stars {
    stroke-width: 1.6;
  }
  /* on dark skies full lime is a stalk, not a glow */
  @media (prefers-color-scheme: dark) {
    .lit {
      opacity: 0.5;
    }
  }
  /* drawn last and cut flush with the viewBox, so the sun rises from behind it */
  .ground {
    stroke-width: 2.4;
  }

  /* as each section scrolls in, the sun travels the last stretch of the day to its hour */
  @media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: view()) {
      .sun,
      .moon,
      .lit,
      .stars {
        animation: linear both;
        animation-timeline: view();
        animation-range: entry 0% cover 45%;
      }
      .sun,
      .moon {
        animation-name: rise;
      }
      .lit {
        animation-name: lit;
      }
      .stars {
        animation-name: stars;
      }
    }
  }
  @keyframes rise {
    from {
      transform: rotate(calc(var(--at) - 40deg));
    }
  }
  @keyframes lit {
    from {
      stroke-dashoffset: var(--off0);
    }
  }
  @keyframes stars {
    from {
      opacity: 0;
    }
  }
</style>
