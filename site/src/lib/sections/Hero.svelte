<script lang="ts">
  import Dua from '$lib/components/Dua.svelte';
  import Notification from '$lib/components/Notification.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';
  import Section from '$lib/components/Section.svelte';
  import { push, store } from '$lib/content';

  const order = store.newOrder;
</script>

<Section
  id="inicio"
  tone="day"
  overlay
  sky="linear-gradient(180deg, var(--sky-0), var(--sky-1))"
  labelledby="inicio-t"
>
  <div class="grid">
    <div class="copy">
      <h1 id="inicio-t" class="t-hero">
        Sua loja viva <span class="l2">na palma da mão.</span>
      </h1>
      <p class="t-lede lede">
        Uma loja online com a sua cara e um app no celular para tocar o dia: pedidos, cardápio,
        horários e Pix. Para doceiras, marmitarias, hamburguerias e padarias.
      </p>
    </div>

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
      <Dua pose="avatar-ola" eager size={240} class="hero-dua" />
    </div>
  </div>
</Section>

<style>
  .grid {
    display: grid;
    gap: clamp(40px, 6vw, 72px);
    align-items: center;
  }
  @media (min-width: 1024px) {
    .grid {
      grid-template-columns: minmax(0, 1.12fr) minmax(0, 0.88fr);
    }
  }

  /* ── copy ─────────────────────────────────────────────────────────── */
  .copy {
    display: grid;
    justify-items: start;
    min-width: 0;
    container-type: inline-size;
  }
  /* "na palma da mão." never splits: the h1 shrinks to the column instead */
  @media (min-width: 560px) {
    h1 {
      font-size: min(clamp(2.75rem, 1.6rem + 4.6vw, 4.75rem), 12.4cqi);
    }
    .l2 {
      display: block;
      white-space: nowrap;
    }
  }
  .lede {
    margin-top: 20px;
    max-width: 40ch;
    /* body copy at 7:1 on the dawn sky; plain --ink-muted sits near 5.5:1 here */
    color: color-mix(in srgb, var(--ink) 50%, var(--ink-muted));
  }
  /* ── stage: sizes in % of the stage so the whole scene scales as one ── */
  .stage {
    position: relative;
    width: min(100%, 540px);
    aspect-ratio: 1 / 1.2;
    justify-self: center;
    container-type: inline-size;
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
  .stage :global(.hero-dua) {
    position: absolute;
    left: 13%;
    bottom: 1%;
    width: 36%;
    z-index: 2;
    filter: drop-shadow(0 14px 18px rgb(18 60 50 / 0.2));
    transform-origin: 40% 90%;
    animation: hello 1.4s var(--ease-soft) 1.1s both;
  }

  @media (prefers-color-scheme: dark) {
    .stage :global(.hero-dua) {
      filter: drop-shadow(0 0 22px color-mix(in srgb, var(--spark) 22%, transparent))
        drop-shadow(0 14px 18px rgb(0 0 0 / 0.4));
    }
  }

  /* after the push lands, Duá says hi */
  @keyframes hello {
    0% {
      transform: translateY(8%) rotate(0);
    }
    35% {
      transform: translateY(0) rotate(-5deg);
    }
    60% {
      transform: rotate(3deg);
    }
    100% {
      transform: none;
    }
  }
</style>
