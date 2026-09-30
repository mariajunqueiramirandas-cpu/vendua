<script lang="ts">
  import Dua from '$lib/components/Dua.svelte';
  import Notification from '$lib/components/Notification.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';
  import Section from '$lib/components/Section.svelte';
  import { push, store } from '$lib/content';

  const order = store.newOrder;
  // the accent is drawn on its own so it can land last
  const letters = ['v', 'e', 'n', 'd', 'u', 'a'];
</script>

<Section
  id="inicio"
  tone="day"
  overlay
  sky="linear-gradient(180deg, var(--sky-0), var(--sky-1))"
  labelledby="inicio-t"
>
  <h1 id="inicio-t" class="mark">
    <span class="sr-only">Venduá: sua loja viva na palma da mão.</span>
    <span class="word" aria-hidden="true">
      <!-- Duá stands behind the letters: the box is cut at the letters' waist, so it climbs out from
           behind the name and, as the page scrolls, ducks back down behind it -->
      <span class="peek"><span class="duck"><Dua pose="avatar-ola" eager size={480} /></span></span>
      {#each letters as l, i (i)}<span class="l" style="--i: {i}"
          >{l}{#if l === 'a'}<i class="acute"></i>{/if}</span
        >{/each}<span class="l dot" style="--i: 6">.</span>
    </span>
    <span class="tag" aria-hidden="true">Sua loja viva na palma da mão.</span>
  </h1>

  <div class="grid">
    <p class="t-lede lede">
      Uma loja online com a sua cara e um app no celular para tocar o dia: pedidos, cardápio,
      horários e Pix. Para doceiras, marmitarias, hamburguerias e padarias.
    </p>

    <div class="stage">
      <div class="back" aria-hidden="true">
        <Phone time="6:12" style="--w: 100%">
          <Screen key="pedidos" alt="" sizes="(max-width: 640px) 38vw, 230px" />
        </Phone>
      </div>
      <div class="front">
        <Phone time="6:12" style="--w: 100%">
          <Screen
            key="inicio"
            eager
            sizes="(max-width: 640px) 50vw, 290px"
            alt="O app da {store.name} aberto no celular: Bom dia, {store.owner}. Loja aberta, {store.salesToday} em vendas e {store.ordersToday} pedidos hoje."
          />
        </Phone>
      </div>
      <div
        class="push"
        role="img"
        aria-label="Notificação no celular: {push.title(
          order.number,
        )}. {order.customer}, {order.total}, {order.mode}."
      >
        <Notification fresh class="hero-note" {...order} />
      </div>
    </div>
  </div>
</Section>

<style>
  /* a damped spring (ζ 0.5) and a looser one (ζ 0.35), sampled for linear() */
  .mark,
  .grid {
    --spring: linear(
      0,
      0.066,
      0.226,
      0.43,
      0.639,
      0.826,
      0.974,
      1.077,
      1.138,
      1.162,
      1.158,
      1.136,
      1.104,
      1.07,
      1.038,
      1.011,
      0.992,
      0.98,
      0.974,
      0.974,
      0.976,
      0.981,
      0.987,
      0.992,
      0.997,
      1,
      1.003,
      1.004,
      1.002,
      1
    );
    --boing: linear(
      0,
      0.085,
      0.295,
      0.564,
      0.832,
      1.057,
      1.214,
      1.294,
      1.306,
      1.266,
      1.193,
      1.108,
      1.028,
      0.965,
      0.924,
      0.906,
      0.908,
      0.924,
      0.949,
      0.975,
      0.998,
      1.016,
      1.026,
      1.03,
      1.027,
      1.021,
      1.013,
      1.005,
      0.999,
      0.994,
      0.991,
      0.992,
      0.997,
      1.001,
      1.002,
      1
    );
  }

  /* ── the name ─────────────────────────────────────────────────────── */
  .mark {
    display: grid;
    container-type: inline-size;
    font-weight: inherit;
  }
  .word {
    position: relative;
    isolation: isolate;
    justify-self: start;
    /* "venduá." is ~3.62em wide in Space Grotesk 700: fill the column, up to a poster size */
    --fs: min(27cqi, 15rem);
    font: 700 var(--fs) / 0.8 var(--font-display);
    letter-spacing: -0.06em;
    color: var(--ink);
    white-space: nowrap;
    /* room above for Duá's head and the accent; letters rise from under the baseline */
    padding-top: 0.86em;
    clip-path: inset(-2em -1em 0 -1em);
  }
  .l {
    position: relative;
    display: inline-block;
  }
  .acute {
    position: absolute;
    left: 0.24em;
    top: -0.19em;
    width: 0.1em;
    height: 0.2em;
    border-radius: 0.05em;
    background: currentColor;
    rotate: 38deg;
  }
  .dot {
    display: inline-block;
    color: var(--ink);
  }
  @media (prefers-color-scheme: dark) {
    .dot {
      color: var(--spark);
    }
  }

  /* the box Duá stands in: its bottom edge is the top of the lowercase, so nothing of him shows
     through the letters' counters */
  .peek {
    position: absolute;
    z-index: -1;
    left: 1.42em;
    bottom: 0.56em;
    width: 1.25em;
    height: 1.02em;
    overflow: clip;
  }
  .duck {
    position: absolute;
    inset: 0;
  }
  .peek :global(.dua) {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    max-width: none;
    transform-origin: 50% 100%;
  }

  .tag {
    margin-top: clamp(14px, 2.4cqi, 28px);
    font: 600 clamp(1.625rem, 1.1rem + 2.4vw, 2.75rem) / 1.08 var(--font-display);
    letter-spacing: -0.03em;
    color: var(--ink);
    text-wrap: balance;
  }

  /* ── below the name ───────────────────────────────────────────────── */
  .grid {
    display: grid;
    gap: clamp(32px, 6vw, 72px);
    align-items: start;
    margin-top: 16px;
  }
  @media (min-width: 1024px) {
    .grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      margin-top: 24px;
    }
  }
  .lede {
    max-width: 40ch;
    /* body copy at 7:1 on the dawn sky; plain --ink-muted sits near 5.5:1 here */
    color: color-mix(in srgb, var(--ink) 50%, var(--ink-muted));
  }

  /* ── stage: sizes in % of the stage so the whole scene scales as one ── */
  .stage {
    position: relative;
    width: min(100%, 540px);
    aspect-ratio: 1 / 1.08;
    justify-self: center;
    container-type: inline-size;
  }
  @media (min-width: 1024px) {
    .stage {
      justify-self: end;
      margin-top: -8cqw;
    }
  }
  .back,
  .front {
    position: absolute;
  }
  .back {
    width: 40%;
    left: 5%;
    top: 15cqw;
    rotate: -7deg;
  }
  .back :global(.phone) {
    filter: saturate(0.85);
  }
  .front {
    width: 49%;
    right: 12%;
    top: 10cqw;
    rotate: 3deg;
  }
  /* drops in over the status bar and the store's name, never over "Bom dia, Nena" */
  .push {
    position: absolute;
    top: -2cqw;
    right: 0;
    width: clamp(236px, 56cqw, 280px);
    rotate: 1.5deg;
    z-index: 3;
  }
  .push :global(.hero-note) {
    width: 100%;
  }

  /* ── the one orchestrated moment: the name builds itself and Duá climbs out to say hi ── */
  @media (prefers-reduced-motion: no-preference) {
    .l {
      animation: rise 0.9s var(--spring) calc(0.15s + var(--i) * 0.07s) both;
    }
    .acute {
      animation: drop 0.9s var(--boing) 0.78s both;
    }
    .l.dot {
      animation: pop 0.8s var(--boing) 0.92s both;
    }
    .peek :global(.dua) {
      animation:
        climb 1s var(--spring) 1.05s both,
        wave 1.1s ease-in-out 1.9s 2;
    }
    .tag {
      animation: show 0.7s var(--ease-soft) 0.55s both;
    }
    .lede,
    .stage {
      animation: show 0.8s var(--ease-soft) 0.8s both;
    }
    .push :global(.hero-note) {
      animation-delay: 2.1s;
    }

    /* scrolling away plays it backwards: Duá ducks behind the name, then the letters sink into the
       ground one after another while the bar's logo takes over (Header.svelte) */
    @supports (animation-timeline: scroll()) {
      .duck {
        animation: duck linear both;
        animation-timeline: scroll(root);
        animation-range: 0 160px;
      }
      .word > .l {
        animation-name: rise, sink;
        animation-duration: 0.9s, auto;
        animation-timing-function: var(--spring), ease-in;
        animation-delay: calc(0.15s + var(--i) * 0.07s), 0s;
        animation-fill-mode: both;
        animation-timeline: auto, scroll(root);
        animation-range:
          normal,
          calc(60px + var(--i) * 22px) calc(200px + var(--i) * 22px);
      }
      .word > .l.dot {
        animation-name: pop, sink;
        animation-duration: 0.8s, auto;
        animation-timing-function: var(--boing), ease-in;
        animation-delay: 0.92s, 0s;
      }
    }
  }
  @keyframes rise {
    from {
      translate: 0 105%;
    }
  }
  @keyframes drop {
    from {
      translate: -0.3em -1.4em;
      rotate: -40deg;
      opacity: 0;
    }
    30% {
      opacity: 1;
    }
  }
  @keyframes pop {
    from {
      scale: 0;
    }
  }
  @keyframes climb {
    from {
      translate: 0 100%;
    }
  }
  @keyframes wave {
    25% {
      rotate: -5deg;
    }
    60% {
      rotate: 4deg;
    }
  }
  @keyframes show {
    from {
      opacity: 0;
      translate: 0 12px;
    }
  }
  @keyframes sink {
    to {
      transform: translateY(110%) rotate(calc(var(--i) * 7deg - 18deg));
    }
  }
  @keyframes duck {
    to {
      translate: 0 100%;
    }
  }
</style>
