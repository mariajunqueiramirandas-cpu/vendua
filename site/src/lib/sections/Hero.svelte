<script lang="ts">
  import Dua from '$lib/components/Dua.svelte';
  import Notification from '$lib/components/Notification.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';
  import Section from '$lib/components/Section.svelte';
  import Soon from '$lib/components/Soon.svelte';
  import { push, store } from '$lib/content';

  const order = store.newOrder;
  const proofs = [
    { icon: 'pix', text: 'Pix direto na sua conta' },
    { icon: 'bag', text: 'Seu cliente compra sem cadastro' },
    { icon: 'clock', text: 'Sua loja no ar em cerca de 1 hora' },
  ] as const;
</script>

<Section
  id="inicio"
  hour="6h"
  tone="day"
  overlay
  sky="linear-gradient(180deg, var(--sky-0), var(--sky-1))"
  labelledby="inicio-t"
>
  <div class="grid">
    <div class="copy">
      <p class="for">
        <i aria-hidden="true"></i>Para doceiras, marmitarias, hamburguerias e padarias
      </p>
      <h1 id="inicio-t" class="t-hero">
        Sua loja <span class="viva"
          ><em class="t-moment">viva</em><svg
            viewBox="0 0 120 18"
            preserveAspectRatio="none"
            aria-hidden="true"
            ><path d="M4 12.5C28 5.5 62 4 116 8.5" /><path d="M22 15c24-4.2 50-5 78-3.4" /></svg
          ></span
        >
        <span class="l2">na palma da mão.</span>
      </h1>
      <p class="t-lede lede">
        Uma loja online com a sua cara e um app no celular para tocar o dia: pedidos, cardápio,
        horários e Pix.
      </p>
      <Soon size="lg" note="Estamos preparando as primeiras lojas." />
      <ul class="proofs">
        {#each proofs as p (p.icon)}
          <li>
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <ellipse class="dab" cx="18" cy="20" rx="10" ry="7" />
              {#if p.icon === 'pix'}
                <rect x="5" y="10" width="21" height="15" rx="3.5" />
                <path d="M20.5 17.5h5.5M16 4v8.5M12.5 9l3.5 3.5 3.5-3.5" />
              {:else if p.icon === 'bag'}
                <path d="M7 11h18l-1.6 14.2a2 2 0 0 1-2 1.8H10.6a2 2 0 0 1-2-1.8z" />
                <path d="M11.5 14V9.5a4.5 4.5 0 0 1 9 0V14" />
              {:else}
                <circle cx="16" cy="17" r="10" />
                <path d="M16 11.5V17l3.5 2.5M13 4.5h6" />
              {/if}
            </svg>
            <span>{p.text}</span>
          </li>
        {/each}
      </ul>
    </div>

    <div class="stage">
      <div class="glow" aria-hidden="true"></div>
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
            alt="O app da {store.name} aberto no celular: Bom dia, {store.owner}. Loja aberta e {store.salesToday} em vendas hoje."
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
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }

  /* ── copy ─────────────────────────────────────────────────────────── */
  .copy {
    display: grid;
    justify-items: start;
    min-width: 0;
  }
  .for {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font: 600 0.875rem/1.35 var(--font-sans);
    color: var(--ink-muted);
  }
  .for i {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 0 4px var(--success-soft);
    transform: translateY(-1px);
    animation: live 2.8s ease-in-out infinite;
  }
  h1 {
    margin-top: 20px;
  }
  .viva {
    position: relative;
    display: inline-block;
    white-space: nowrap;
  }
  em {
    display: inline-block;
    font-size: 1.14em;
    line-height: 0.8;
    padding-inline: 0.02em 0.06em;
  }
  .viva svg {
    position: absolute;
    left: -2%;
    bottom: -0.2em;
    width: 104%;
    height: 0.26em;
    overflow: visible;
    z-index: -1;
    fill: none;
    stroke: var(--spark);
    stroke-linecap: round;
  }
  .viva path:first-child {
    stroke-width: 10;
  }
  .viva path:last-child {
    stroke-width: 5;
    opacity: 0.75;
  }
  @media (min-width: 560px) {
    .l2 {
      display: block;
    }
  }
  .lede {
    margin-top: 22px;
    margin-bottom: 30px;
    max-width: 40ch;
  }
  .proofs {
    list-style: none;
    margin: 36px 0 0;
    padding: 24px 0 0;
    border-top: 1px solid var(--line);
    display: flex;
    flex-wrap: wrap;
    gap: 12px 26px;
    font: 600 0.9375rem/1.3 var(--font-sans);
    color: var(--ink);
  }
  .proofs li {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .proofs svg {
    flex: none;
    width: 30px;
    height: 30px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .proofs .dab {
    fill: var(--spark);
    stroke: none;
    opacity: 0.85;
  }
  @media (max-width: 559px) {
    .proofs {
      flex-direction: column;
    }
  }
  @media (min-width: 560px) {
    .proofs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
      width: 100%;
      max-width: 560px;
    }
    .proofs li {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }
    .proofs svg {
      width: 34px;
      height: 34px;
    }
  }

  /* ── stage: sizes in % of the stage so the whole scene scales as one ── */
  .stage {
    position: relative;
    width: min(100%, 540px);
    aspect-ratio: 1 / 1.2;
    justify-self: center;
    container-type: inline-size;
  }
  .glow {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 124%;
    aspect-ratio: 1;
    translate: -50% -50%;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--spark) 90%, transparent) 0%,
      color-mix(in srgb, var(--spark) 36%, transparent) 36%,
      transparent 66%
    );
    animation: breathe 6s ease-in-out infinite;
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
    .glow {
      background: radial-gradient(
        circle,
        color-mix(in srgb, var(--spark) 34%, transparent) 0%,
        color-mix(in srgb, var(--spark) 12%, transparent) 38%,
        transparent 66%
      );
    }
    .proofs .dab {
      opacity: 0.3;
    }
    .stage :global(.hero-dua) {
      filter: drop-shadow(0 0 22px color-mix(in srgb, var(--spark) 22%, transparent))
        drop-shadow(0 14px 18px rgb(0 0 0 / 0.4));
    }
  }

  @keyframes breathe {
    0%,
    100% {
      scale: 0.94;
      opacity: 0.85;
    }
    50% {
      scale: 1.04;
      opacity: 1;
    }
  }
  @keyframes live {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
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
