<script lang="ts">
  import Dua from './Dua.svelte';
  import Footer from './Footer.svelte';
  import Header from './Header.svelte';
  import Seo from './Seo.svelte';
</script>

<Seo title="Página não encontrada · Venduá" path="/404/" noindex />
<Header home={false} overlay />

<main id="conteudo" class="lost">
  <div class="wrap row">
    <div class="copy">
      <p class="t-label kicker">Erro 404</p>
      <h1 class="t-display">Essa página saiu para entrega.</h1>
      <p class="t-lede">
        E ainda não voltou. Talvez o endereço tenha mudado, ou ela nunca tenha existido. O resto da
        loja continua aqui, abertinha.
      </p>
      <div class="actions">
        <a class="primary" href="/">
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><path d="M4 11.5 12 5l8 6.5M6.5 10v9h11v-9M10 19v-5h4v5" /></svg
          >
          Voltar para o início
        </a>
        <a class="quiet" href="/#perguntas">Ver as perguntas</a>
      </div>
    </div>

    <div class="scene" aria-hidden="true">
      <!-- the delivery route, inked like the admin's illustrations: Duá has the box, home is at the end -->
      <svg class="route" viewBox="0 0 320 200" fill="none">
        <path
          class="road"
          d="M206 150c22 8 44 6 58-8s4-34 14-48 6-20 2-26"
          stroke-dasharray="2 12"
        />
        <ellipse class="spot" cx="280" cy="60" rx="26" ry="7" />
        <path class="house" d="M262 50V34l18-14 18 14v16M275 50v-9h10v9" />
      </svg>
      <span class="disc"></span>
      <Dua pose="entrega" size={300} eager class="lost-dua" />
    </div>
  </div>
</main>

<Footer />

<style>
  /* late-afternoon sky, the hour deliveries go out */
  .lost {
    background: linear-gradient(180deg, var(--sky-3) 0%, var(--sky-4) 100%);
    padding-top: 68px;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 24px;
    min-height: calc(100svh - 68px - 100px);
    padding-block: 32px 64px;
  }
  .copy {
    display: grid;
    gap: 16px;
    max-width: 32rem;
  }
  .kicker {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-muted);
  }
  .kicker::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--warning);
  }
  .t-lede {
    color: var(--ink-muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
    margin-top: 8px;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 22px 0 18px;
    border-radius: var(--radius-md);
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: var(--shadow-e1);
    font-weight: 600;
    text-decoration: none;
    transition:
      background var(--duration-quick) var(--ease-soft),
      transform var(--duration-quick) var(--ease-soft);
  }
  .primary:hover {
    background: var(--primary-hover);
  }
  .primary:active {
    transform: scale(0.98);
  }
  .primary svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .quiet {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-weight: 600;
    text-underline-offset: 4px;
    text-decoration-thickness: 1.5px;
    text-decoration-color: color-mix(in srgb, var(--ink) 40%, transparent);
  }

  .scene {
    position: relative;
    justify-self: center;
    width: min(100%, 340px);
    aspect-ratio: 1.15;
    display: grid;
    place-items: center;
    container-type: inline-size;
  }
  .route {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    color: var(--ink-muted);
  }
  .route path {
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .spot {
    fill: var(--spark);
    opacity: 0.8;
  }
  .disc {
    position: absolute;
    left: 4%;
    bottom: 2%;
    width: 64%;
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow-e1);
  }
  .scene :global(.lost-dua) {
    position: absolute;
    left: 6%;
    bottom: 4%;
    width: 60%;
    filter: drop-shadow(0 10px 14px rgb(18 60 50 / 0.16));
    animation: trot 1.2s var(--ease-soft) 0.2s both;
  }
  @keyframes trot {
    from {
      transform: translateX(-14px) rotate(-4deg);
    }
    to {
      transform: none;
    }
  }

  @media (min-width: 768px) {
    .row {
      grid-template-columns: minmax(0, 1fr) minmax(0, 420px);
      gap: 48px;
      padding-block: 48px 88px;
    }
    .scene {
      width: 100%;
    }
  }

  @media (prefers-color-scheme: dark) {
    /* a lit disc so the forest-green Duá reads on the night palette */
    .disc {
      background: var(--after-ink);
      box-shadow: 0 0 60px color-mix(in srgb, var(--spark) 14%, transparent);
    }
    .scene :global(.lost-dua) {
      filter: drop-shadow(0 10px 14px rgb(0 0 0 / 0.3));
    }
    .spot {
      opacity: 0.5;
    }
  }
</style>
