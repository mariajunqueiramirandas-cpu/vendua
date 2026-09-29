<script lang="ts">
  import Dua from '$lib/components/Dua.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';
  import Section from '$lib/components/Section.svelte';
  import Tablet from '$lib/components/Tablet.svelte';
  import { store } from '$lib/content';

  const recap = [
    {
      title: 'Quanto vendeu',
      text: `${store.salesToday} hoje, comparado com o mesmo dia da semana passada.`,
    },
    {
      title: 'Quantos pedidos',
      text: `${store.ordersToday} pedidos, e quanto cada cliente gastou em média.`,
    },
    {
      title: 'O mais vendido',
      text: 'O campeão do dia, pra você saber o que caprichar na próxima fornada.',
    },
    {
      title: 'A hora do aperto',
      text: 'O horário mais movimentado, pra deixar tudo pronto antes dele.',
    },
  ];

  const reports = [
    'vendas por dia',
    'os mais vendidos',
    'horários de pico',
    'quem visitou e quem pediu',
    'quem voltou a pedir',
    'planilha pra baixar',
  ];
  const day = store.dayRecap;
</script>

<Section id="seu-dia" hour="18h" tone="after" sky="var(--sunset)" labelledby="seu-dia-t">
  <!-- the sky: the sun sets in the band, the moon and stars come out below it -->
  <div class="sky" aria-hidden="true">
    <span class="sun"></span>
    <span class="horizon"></span>
    <span class="stars s1"></span>
    <span class="stars s2"></span>
  </div>

  <div class="moment">
    <div class="copy">
      <h2 id="seu-dia-t" class="title t-moment">A loja fecha e te conta como foi o dia.</h2>
      <p class="t-lede">
        Na hora de fechar, a conta já está feita. O resumo do dia aparece no início do app,
        esperando por você, sem caderno e sem calculadora.
      </p>
      <ul class="recap" role="list">
        {#each recap as r (r.title)}
          <li>
            <h3 class="recap-t">{r.title}</h3>
            <p>{r.text}</p>
          </li>
        {/each}
      </ul>
    </div>

    <figure class="art">
      <div class="phone">
        <span class="moon" aria-hidden="true"></span>
        <Dua pose="carinho" size={220} class="dua" />
        <Phone time="18:07" style="--w: var(--phone-w)">
          <Screen
            key="seuDia"
            alt="O início do app no fim do dia, com a loja fechada: Boa noite, {store.owner}. Seu dia: {store.salesToday}, {day.vsLastWeek}% acima do mesmo dia da semana passada; {store.ordersToday} pedidos, ticket médio de {day.avgTicket}. No resumo do dia, o campeão foi {day.bestSeller.name.toLowerCase()} ({day
              .bestSeller.qty}) e a hora mais movimentada, {day.busiestHour}."
            sizes="(max-width: 1199px) 60vw, 300px"
          />
        </Phone>
      </div>
      <figcaption class="sr-only">O resumo do dia na tela de início do app.</figcaption>
    </figure>
  </div>

  <div class="reports">
    <div class="reports-copy">
      <p class="kicker t-label">Quando quiser olhar mais longe</p>
      <h3 class="t-title-1">Relatórios que se explicam.</h3>
      <p class="reports-lede">
        Cada gráfico vem com uma frase dizendo o que ele mostra. Escolha hoje, 7 dias, 30 dias ou as
        datas que quiser, no celular ou no computador.
      </p>
      <ul class="tags" role="list">
        {#each reports as t (t)}<li>{t}</li>{/each}
      </ul>
    </div>
    <div class="reports-art">
      <Tablet>
        <Screen
          key="relatorios"
          alt="Relatórios da Bolos da Nena nos últimos 7 dias: vendas, pedidos, ticket médio, clientes novos e quem voltou a pedir; um gráfico de vendas por dia, o funil do olhar ao pedido, os mais vendidos e os horários de pico."
          sizes="(max-width: 599px) 170vw, (max-width: 959px) 92vw, 680px"
        />
      </Tablet>
    </div>
  </div>
</Section>

<style>
  /* ── sky decoration (drawn in section coordinates: .inner starts at the section top) ── */
  .sky {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: -1;
  }
  .sun {
    --d: clamp(150px, 20vw, 230px);
    position: absolute;
    top: calc(212px - var(--d) / 2);
    right: 6%;
    width: var(--d);
    height: calc(var(--d) / 2);
    border-radius: var(--d) var(--d) 0 0;
    /* illustration colours: a late sun that warms to rose where it meets the horizon */
    background: linear-gradient(180deg, #fbe1b0 0%, #f2b98c 55%, #d99282 100%);
    box-shadow: 0 0 80px 24px rgb(251 214 160 / 0.35);
    opacity: 0.95;
  }
  .horizon {
    position: absolute;
    top: 212px;
    left: 50%;
    width: 100vw;
    height: 1.5px;
    transform: translateX(-50%);
    background: linear-gradient(
      90deg,
      transparent,
      rgb(247 244 234 / 0.35) 20%,
      rgb(247 244 234 / 0.35) 80%,
      transparent
    );
  }
  /* soft reflection under the horizon, so the sun sits on something */
  .horizon::after {
    content: '';
    position: absolute;
    top: 6px;
    right: calc(6% + (100vw - 100%) / 2);
    width: clamp(150px, 20vw, 230px);
    height: 40px;
    background:
      linear-gradient(rgb(251 214 160 / 0.4), rgb(251 214 160 / 0.4)) 50% 0 / 70% 2px no-repeat,
      linear-gradient(rgb(251 214 160 / 0.28), rgb(251 214 160 / 0.28)) 50% 10px / 46% 2px no-repeat,
      linear-gradient(rgb(251 214 160 / 0.18), rgb(251 214 160 / 0.18)) 50% 20px / 26% 2px no-repeat;
  }
  /* stars stay in the right half, clear of the copy; below 1200px only beside the title */
  .stars {
    position: absolute;
    top: 250px;
    left: 50%;
    width: 100vw;
    height: 170px;
    transform: translateX(-50%);
    background-repeat: no-repeat;
  }
  .s1 {
    background-image:
      radial-gradient(circle, rgb(247 244 234 / 0.9) 0 1.4px, transparent 2px),
      radial-gradient(circle, rgb(247 244 234 / 0.8) 0 1.2px, transparent 1.8px),
      radial-gradient(circle, rgb(247 244 234 / 0.9) 0 1.6px, transparent 2.2px),
      radial-gradient(circle, rgb(247 244 234 / 0.7) 0 1.2px, transparent 1.8px),
      radial-gradient(circle, rgb(247 244 234 / 0.8) 0 1.4px, transparent 2px);
    background-size: 8px 8px;
    background-position:
      64% 8%,
      74% 70%,
      81% 30%,
      90% 6%,
      97% 52%;
  }
  .s2 {
    background-image:
      radial-gradient(circle, rgb(247 244 234 / 0.6) 0 1px, transparent 1.6px),
      radial-gradient(circle, rgb(247 244 234 / 0.7) 0 1.2px, transparent 1.8px),
      radial-gradient(circle, rgb(247 244 234 / 0.5) 0 1px, transparent 1.6px),
      radial-gradient(circle, rgb(247 244 234 / 0.6) 0 1px, transparent 1.6px),
      radial-gradient(circle, rgb(247 244 234 / 0.7) 0 1.2px, transparent 1.8px),
      radial-gradient(circle, rgb(247 244 234 / 0.5) 0 1px, transparent 1.6px);
    background-size: 6px 6px;
    background-position:
      68% 40%,
      77% 12%,
      86% 84%,
      94% 28%,
      99% 90%,
      60% 96%;
  }

  /* ── the moment: copy + phone, Duá against the moon ──────────────── */
  .moment {
    /* everything readable starts below the warm part of the sunset band */
    padding-top: calc(272px - clamp(64px, 9vw, 128px));
    display: grid;
    gap: clamp(48px, 8vw, 72px);
  }
  .copy {
    display: grid;
    gap: 20px;
    align-content: start;
  }
  .title {
    font-size: clamp(2.5rem, 1.6rem + 3.6vw, 4.25rem);
    line-height: 1.02;
    max-width: 13ch;
    color: var(--ink);
  }
  .recap {
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 2px;
    max-width: 30rem;
  }
  .recap li {
    display: grid;
    gap: 2px;
    padding: 14px 0 14px 28px;
    position: relative;
    border-top: 1px solid var(--line);
  }
  .recap li:last-child {
    border-bottom: 1px solid var(--line);
  }
  /* a small star per line, the same light as the sky */
  .recap li::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 21px;
    width: 10px;
    height: 10px;
    background: var(--ink);
    clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%);
    opacity: 0.85;
  }
  .recap-t {
    font: 600 1.0625rem/1.4 var(--font-display);
    letter-spacing: -0.01em;
  }
  .recap p {
    color: var(--ink-muted);
    font-size: 1rem;
    line-height: 1.5;
  }

  .art {
    --phone-w: min(290px, 60vw);
    /* Duá's column: whatever the phone leaves, tucking 12px behind its bezel */
    --side: min(190px, 100vw - 2 * var(--gutter) - var(--phone-w) + 12px);
    margin: 0;
    display: grid;
    justify-items: center;
    padding-top: 8px;
  }
  .phone {
    position: relative;
    width: var(--phone-w);
    margin-left: calc(var(--side) - 12px);
  }
  .phone > :global(.phone) {
    position: relative;
    z-index: 1;
  }
  /* a full moon behind Duá, pale enough that the dark green fur reads against it */
  .moon {
    --d: calc(var(--side) * 1.3);
    position: absolute;
    z-index: 0;
    width: var(--d);
    aspect-ratio: 1;
    /* left edge lines up with Duá's, so it never crosses the gutter */
    right: calc(100% - var(--d) + var(--side) - 12px);
    bottom: calc(var(--side) * 0.45);
    border-radius: 50%;
    background:
      radial-gradient(circle at 30% 34%, rgb(0 0 0 / 0.05) 0 9%, transparent 9.5%),
      radial-gradient(circle at 62% 24%, rgb(0 0 0 / 0.04) 0 6%, transparent 6.5%),
      radial-gradient(circle at 70% 60%, rgb(0 0 0 / 0.04) 0 11%, transparent 11.5%),
      radial-gradient(circle at 40% 40%, #fbf8ee, #ece4cc 70%, #e2d8ba);
    box-shadow:
      0 0 0 18px rgb(247 244 234 / 0.04),
      0 0 0 44px rgb(247 244 234 / 0.025),
      0 0 120px 30px rgb(247 244 234 / 0.12);
  }
  .phone :global(.dua) {
    position: absolute;
    z-index: 2;
    width: var(--side);
    right: calc(100% - 12px);
    bottom: -6px;
  }

  /* ── second beat: reports on the tablet ─────────────────────────── */
  .reports {
    margin-top: clamp(72px, 10vw, 120px);
    padding-top: clamp(40px, 6vw, 64px);
    border-top: 1px solid var(--line);
    display: grid;
    gap: 32px;
  }
  .reports-copy {
    display: grid;
    gap: 12px;
    align-content: center;
    max-width: 30rem;
  }
  .kicker {
    color: var(--ink-muted);
  }
  .reports-lede {
    color: var(--ink-muted);
  }
  .tags {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tags li {
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: 0.875rem;
    line-height: 1.25rem;
    color: var(--ink);
  }

  @media (min-width: 1200px) {
    .stars {
      height: min(900px, calc(100% - 250px));
    }
    .sun {
      right: auto;
      left: 18%;
    }
    .horizon::after {
      right: auto;
      left: calc(18% + (100vw - 100%) / 2);
    }
    .moment {
      grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
      align-items: center;
      /* the copy keeps its distance from the band; the phone may rise into the dusk */
      padding-top: 0;
    }
    .copy {
      padding-top: calc(272px - clamp(64px, 9vw, 128px));
    }
    .copy .t-lede {
      max-width: 30rem;
    }
    .art {
      --phone-w: 300px;
      justify-items: end;
      padding-top: calc(150px - clamp(64px, 9vw, 128px));
    }
    .phone {
      margin-left: 0;
      margin-right: clamp(0px, 3vw, 40px);
    }
    .moon {
      --d: 320px;
      right: calc(100% - 40px);
      bottom: 90px;
    }
    .phone :global(.dua) {
      width: 230px;
      right: calc(100% - 14px);
      bottom: -4px;
    }
  }
  /* phones: the tablet runs off the right edge (the section clips it), so the report is big enough to read */
  @media (max-width: 599px) {
    .reports-art {
      width: 170%;
    }
  }
  @media (min-width: 960px) {
    .reports {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      align-items: center;
      gap: 56px;
    }
  }

  /* Noite: the band is already dusk, so the sun is only an ember at the horizon */
  @media (prefers-color-scheme: dark) {
    .sun {
      background: linear-gradient(180deg, #7d5a4a 0%, #5a3f3d 100%);
      box-shadow: 0 0 60px 12px rgb(160 110 80 / 0.18);
      opacity: 0.8;
    }
    .horizon::after {
      opacity: 0.4;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .s2 {
      animation: twinkle 5s ease-in-out infinite alternate;
    }
    .sun {
      animation: settle 1.4s var(--ease-soft) both;
    }
  }
  @keyframes twinkle {
    from {
      opacity: 1;
    }
    to {
      opacity: 0.35;
    }
  }
  @keyframes settle {
    from {
      transform: translateY(-14px);
    }
  }
</style>
