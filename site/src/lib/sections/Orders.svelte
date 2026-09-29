<script lang="ts">
  import Dua from '$lib/components/Dua.svelte';
  import LockScreen from '$lib/components/LockScreen.svelte';
  import Notification from '$lib/components/Notification.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';
  import Section from '$lib/components/Section.svelte';
  import Tablet from '$lib/components/Tablet.svelte';
  import { store } from '$lib/content';

  const n = store.newOrder;
  const e = store.earlierOrder;

  const lockLabel =
    `Tela de bloqueio do celular. No alto, a notificação Pedido #${n.number} chegou: ` +
    `${n.customer}, ${n.total}, ${n.mode}, com o botão aceitar. ` +
    `Logo abaixo, o pedido #${e.number} da ${e.customer}, de 3 minutos atrás.`;

  const facts = [
    {
      title: 'Aceite com o tempo de preparo',
      text: 'Um toque em 15, 30 ou 45 minutos, e o cliente já sabe quando fica pronto.',
    },
    {
      title: 'Encomendas no calendário',
      text: 'O bolo da festa de sábado aparece no sábado, com tudo que o cliente pediu.',
    },
    {
      title: 'Comanda e WhatsApp',
      text: 'Imprima a comanda para a cozinha. Precisa combinar algo? Chame o cliente no WhatsApp.',
    },
    {
      title: 'Sem cadastro, sem senha',
      text: 'O cliente compra sem criar conta e acompanha o pedido até chegar.',
    },
  ];
</script>

<Section
  id="pedidos"
  hour="12h"
  tone="day"
  sky="linear-gradient(180deg, var(--sky-2), var(--sky-3))"
  labelledby="pedidos-t"
>
  <header class="head">
    <h2 id="pedidos-t" class="t-display">Um toque aceita. Outro avisa que saiu.</h2>
    <p class="t-lede">
      O pedido chega com som, vibração e aviso no celular, mesmo com o app fechado. Você aceita dali
      mesmo, e o cliente acompanha cada passo.
    </p>
  </header>

  <figure class="stage">
    <div class="board">
      <Tablet>
        <Screen
          key="quadro"
          alt="O quadro de pedidos da Bolos da Nena: novos, em preparo, prontos e concluídos, cada pedido com o seu botão."
          sizes="(max-width: 999px) 92vw, (max-width: 1280px) 76vw, 1000px"
        />
      </Tablet>
    </div>
    <div class="lock">
      <Phone status={false} label={lockLabel} style="--w: var(--lock-w)">
        <LockScreen time="12:04">
          <Notification variant="lock" fresh action {...n} />
          <Notification variant="lock" when="3 min" {...e} />
        </LockScreen>
      </Phone>
    </div>
    <figcaption class="caption t-caption">
      <span class="dot" aria-hidden="true"></span>
      No tablet da cozinha, o quadro anda com você: novo, em preparo, pronto, entregue. A tela fica ligada
      enquanto a loja está aberta.
    </figcaption>
  </figure>

  <ul class="facts" role="list">
    {#each facts as f (f.title)}
      <li>
        <h3 class="fact-t">{f.title}</h3>
        <p>{f.text}</p>
      </li>
    {/each}
  </ul>

  <div class="pause">
    <div class="pause-copy">
      <Dua pose="horarios" size={112} class="dua-sm" />
      <p class="kicker t-label">Acabou a massa?</p>
      <h3 class="t-title-1">Pausa em dois toques.</h3>
      <p class="pause-lede">
        A loja para de receber pedidos na hora, e quem entra lê o seu recado. O que já está na
        cozinha segue normalmente.
      </p>
      <ol class="taps" role="list">
        <li>
          <span class="num" aria-hidden="true">1</span> Escolha: 15 min, 1 hora ou o resto do dia.
        </li>
        <li><span class="num" aria-hidden="true">2</span> Toque em pausar agora. Pronto.</li>
      </ol>
    </div>
    <div class="pause-art">
      <span class="sun" aria-hidden="true"></span>
      <Phone width={264} time="12:10">
        <div class="shot">
          <Screen
            key="pausar"
            alt="Pausar a loja: por quanto tempo (15 min, 1 hora, resto do dia, até eu voltar), um campo para o recado e o botão pausar agora."
            sizes="(max-width: 560px) 70vw, 264px"
          />
          <span class="mark m1" aria-hidden="true">1</span>
          <span class="mark m2" aria-hidden="true">2</span>
        </div>
      </Phone>
      <Dua pose="horarios" size={150} class="dua" />
    </div>
  </div>
</Section>

<style>
  .head {
    display: grid;
    gap: 16px;
    max-width: 40rem;
  }

  /* ── the board and the lock screen ─────────────────────────────── */
  .stage {
    --lock-w: min(260px, 72vw);
    margin: clamp(40px, 6vw, 72px) 0 0;
    display: grid;
    justify-items: center;
    gap: 28px;
  }
  .lock {
    order: -1;
    display: flex;
    justify-content: center;
    width: 100%;
  }
  .board {
    width: 100%;
  }
  .caption {
    justify-self: start;
    display: flex;
    gap: 10px;
    align-items: baseline;
    max-width: 44ch;
    color: var(--ink-muted);
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--spark);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--spark) 35%, transparent);
    transform: translateY(-1px);
  }

  @media (min-width: 1000px) {
    .stage {
      container-type: inline-size;
      position: relative;
      display: block;
      padding: 0 0 clamp(48px, 7cqw, 88px) 13%;
      --lock-w: clamp(224px, 22cqw, 264px);
    }
    .lock {
      position: absolute;
      left: 0;
      bottom: 0;
      z-index: 2;
      width: var(--lock-w);
    }
    .caption {
      margin: 20px 0 0 calc(var(--lock-w) - 13cqw + 28px);
    }
  }

  /* the new order drops in as the phone scrolls into view (Notification plays it on load otherwise) */
  @media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: view()) {
      .lock :global(.fresh) {
        animation: arrive var(--ease-soft) both;
        animation-timeline: view();
        animation-range: entry 40% cover 40%;
      }
    }
  }
  @keyframes arrive {
    from {
      transform: translateY(-24%) scale(0.96);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }

  /* ── order-day facts ───────────────────────────────────────────── */
  .facts {
    list-style: none;
    margin: clamp(48px, 7vw, 88px) 0 0;
    padding: 0;
    display: grid;
    gap: 24px 32px;
  }
  .facts li {
    display: grid;
    gap: 6px;
    align-content: start;
    padding-top: 16px;
    border-top: 1px solid var(--line-strong);
  }
  .fact-t {
    font: 600 1.0625rem/1.35 var(--font-display);
    letter-spacing: -0.01em;
  }
  .facts p {
    font-size: 1rem;
    line-height: 1.55;
  }
  @media (min-width: 640px) {
    .facts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1100px) {
    .facts {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  /* ── pause in two taps ─────────────────────────────────────────── */
  .pause {
    margin-top: clamp(72px, 10vw, 128px);
    display: grid;
    gap: 40px;
    align-items: center;
  }
  .pause-copy {
    display: grid;
    gap: 14px;
    max-width: 30rem;
  }
  .kicker {
    color: var(--ink-muted);
  }
  .pause-lede {
    font-size: 1.0625rem;
    line-height: 1.6;
  }
  .taps {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  .taps li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    font-weight: 500;
  }
  .num,
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--spark);
    color: var(--on-spark);
    font-family: var(--font-display);
    font-weight: 700;
  }
  .num {
    width: 28px;
    height: 28px;
    font-size: 0.875rem;
  }

  .pause-art {
    position: relative;
    display: flex;
    justify-content: center;
    padding: 24px 0 8px;
  }
  .sun {
    position: absolute;
    z-index: -1;
    top: 50%;
    left: 50%;
    width: min(440px, 108%);
    aspect-ratio: 1;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: radial-gradient(
      closest-side,
      var(--surface-sunken) 0%,
      color-mix(in srgb, var(--surface-sunken) 60%, transparent) 70%,
      transparent 100%
    );
  }
  .shot {
    position: relative;
  }
  /* numbered taps over the real screenshot: the "1 hora" chip and the pausar agora button */
  .mark {
    position: absolute;
    width: 8.4cqw;
    height: 8.4cqw;
    font-size: 4.4cqw;
    box-shadow:
      0 0 0 0.9cqw var(--app-bg),
      0 4px 10px rgb(18 60 50 / 0.25);
  }
  .m1 {
    left: 40%;
    top: 27.6%;
  }
  .m2 {
    left: 22%;
    top: 92.6%;
  }
  .pause-art :global(.dua) {
    position: absolute;
    bottom: -8px;
    width: clamp(104px, 30vw, 150px);
  }

  .pause-copy :global(.dua-sm) {
    margin-bottom: -4px;
  }
  .pause-art :global(.dua) {
    display: none;
  }

  @media (min-width: 820px) {
    .pause-copy :global(.dua-sm) {
      display: none;
    }
    .pause-art :global(.dua) {
      display: block;
    }
    .pause {
      grid-template-columns: minmax(0, 30rem) minmax(0, 440px);
      justify-content: center;
      gap: clamp(40px, 8vw, 120px);
    }
    .pause-art :global(.dua) {
      right: calc(50% + 132px - 22px);
    }
  }
</style>
