<script lang="ts">
  import Dua, { type Pose } from '$lib/components/Dua.svelte';
  import Section from '$lib/components/Section.svelte';
  import Start from '$lib/components/Start.svelte';
  import { plans, site } from '$lib/content';

  const steps: { pose: Pose; title: string; text: string }[] = [
    {
      pose: 'avatar-ola',
      title: 'Você conta como vende',
      text: 'O que sai da sua cozinha, onde você entrega e como recebe. Do seu jeito, com as suas palavras.',
    },
    {
      pose: 'personalizar',
      title: 'O Duá monta a loja com você',
      text: 'São 8 perguntinhas, uma de cada vez, e a loja vai se montando do lado. Em cerca de uma hora ela está no ar.',
    },
    {
      pose: 'sucesso',
      title: 'Chega o primeiro pedido',
      text: 'O celular apita, você aceita direto da notificação e começa a preparar. Daí em diante a loja anda com você.',
    },
  ];

  const { mirim, bandeira, pangolin } = plans;
  const faq: { q: string; a: string }[] = [
    {
      q: 'Já posso criar a minha loja?',
      a: `Pode, o cadastro está aberto. Você escolhe o plano, dá o nome da loja e confirma o seu WhatsApp. No ${bandeira.short}, você começa com ${bandeira.trial}, sem cartão; no ${mirim.short} e no ${pangolin.short}, paga o primeiro mês.`,
    },
    {
      q: 'O que é o Vendedor?',
      a: `Uma IA que atende os seus clientes no WhatsApp da loja e fecha o pedido com eles, com os preços e os horários da sua loja. Você dá o nome que quiser pra ela. Vem no ${bandeira.short}, com ${bandeira.conversations} conversas por mês (${bandeira.trialConversations} durante o teste), e no ${pangolin.short}, com ${pangolin.conversations}. Cada cliente que fala com o Vendedor conta uma conversa a cada 24 horas.`,
    },
    {
      q: 'Preciso entender de tecnologia?',
      a: 'Não. Se você usa o WhatsApp, dá conta. O Duá pergunta uma coisa de cada vez, e no dia a dia é chegou pedido, você aceita.',
    },
    {
      q: 'Meus clientes precisam baixar app ou criar conta?',
      a: 'Não. Eles abrem o link da sua loja no navegador, escolhem e pagam, sem cadastro e sem senha. Depois acompanham o pedido pela mesma página.',
    },
    {
      q: 'O Pix cai onde?',
      a: 'Direto na sua conta do Mercado Pago. A loja também aceita cartão e dinheiro.',
    },
    {
      q: 'Funciona no meu celular?',
      a: 'Funciona no Android e no iPhone. O app instala pelo navegador, sem loja de aplicativos, e abre mesmo sem internet com os últimos dados. Na cozinha, a tela fica ligada.',
    },
    {
      q: 'Posso mudar a loja depois?',
      a: 'Quando quiser. Em Aparência você mexe na página da loja e nas cores, e vê exatamente como vai ficar antes de publicar. Se uma cor ficar difícil de ler, o app avisa.',
    },
    {
      q: 'Dá pra ter mais gente cuidando?',
      a: 'Dá. Você chama a sua equipe e escolhe o papel de cada um: dono, gerente ou atendente. E o app guarda quem fez o quê.',
    },
  ];
</script>

<Section id="comecar" tone="after" sky="var(--sunset-night)" labelledby="comecar-t" class="night">
  <!-- the sun sets in the band at the top, then the stars come out -->
  <div class="dusk" aria-hidden="true">
    <span class="sun"></span>
    <span class="horizon"></span>
  </div>
  <div class="stars" aria-hidden="true"><i></i><i></i><i></i></div>

  <!-- 1 · how it starts -->
  <header class="head">
    <h2 id="comecar-t" class="t-display">Três passos até o primeiro pedido.</h2>
    <p class="t-lede">
      Sem reunião e sem planilha. Você responde umas perguntas no celular e a loja fica pronta.
    </p>
  </header>

  <ol class="steps" role="list">
    {#each steps as s, i (s.pose)}
      <li class="step" class:first-order={i === steps.length - 1}>
        <span class="lamp">
          <Dua pose={s.pose} size={200} class="step-dua" />
        </span>
        <span class="num tnum" aria-hidden="true">{i + 1}</span>
        <div class="step-copy">
          <h3 class="t-title-2"><span class="sr-only">Passo {i + 1}: </span>{s.title}</h3>
          <p>{s.text}</p>
        </div>
      </li>
    {/each}
  </ol>

  <!-- 2 · questions -->
  <div class="faq" id="perguntas">
    <div class="faq-head">
      <span class="lamp faq-lamp"><Dua pose="avatar-pensando" size={120} class="step-dua" /></span>
      <h3 class="t-title-1">Perguntas de quem faz</h3>
      <p>O que as doceiras, as marmitarias e as padarias mais perguntam pra gente.</p>
    </div>
    <div class="faq-list">
      {#each faq as f (f.q)}
        <details>
          <summary>
            <span>{f.q}</span>
            <i class="plus" aria-hidden="true"></i>
          </summary>
          <p class="answer">{f.a}</p>
        </details>
      {/each}
    </div>
  </div>

  <!-- 3 · good night -->
  <div class="close">
    <p class="moment t-display">A próxima loja no ar pode ser a sua.</p>
    <div class="cta">
      <Start tone="after" />
      <p class="plans tnum">
        {bandeira.short} por {bandeira.price}/mês, com {bandeira.trial}. Também tem o {mirim.short},
        por {mirim.price}/mês, e o {pangolin.short}, por {pangolin.price}/mês.
      </p>
      <p class="follow">
        Acompanhe no Instagram:
        <a href={site.instagram.url} rel="noopener" target="_blank"
          >{site.instagram.handle}<span class="sr-only"> (abre em nova aba)</span></a
        >
      </p>
    </div>
  </div>
</Section>

<style>
  /* ── dusk: the sun on the horizon, drawn in section coordinates inside the 340 px band ── */
  .dusk {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }
  .sun {
    --d: clamp(140px, 18vw, 210px);
    position: absolute;
    top: calc(200px - var(--d) / 2);
    right: 8%;
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
    top: 200px;
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
  @media (prefers-color-scheme: dark) {
    .sun {
      background: linear-gradient(180deg, #7d5a4a 0%, #5a3f3d 100%);
      box-shadow: 0 0 60px 12px rgb(160 110 80 / 0.18);
      opacity: 0.8;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .sun {
      animation: settle 1.4s var(--ease-soft) both;
    }
  }
  @keyframes settle {
    from {
      transform: translateY(-14px);
    }
  }

  /* ── the night sky: three star layers, denser near the top, fading before the questions ── */
  .stars {
    position: absolute;
    z-index: -1;
    top: 260px;
    left: 50%;
    width: 100vw;
    height: min(100%, 1400px);
    transform: translateX(-50%);
    pointer-events: none;
    mask-image: linear-gradient(180deg, #000 0%, #000 35%, transparent 80%);
  }
  .stars i {
    position: absolute;
    inset: 0;
    --star: color-mix(in srgb, var(--after-ink) 85%, transparent);
    --dim: color-mix(in srgb, var(--after-ink) 45%, transparent);
  }
  .stars i:nth-child(1) {
    background:
      radial-gradient(1px 1px at 7% 12%, var(--dim), transparent),
      radial-gradient(1px 1px at 19% 31%, var(--dim), transparent),
      radial-gradient(1px 1px at 33% 8%, var(--dim), transparent),
      radial-gradient(1px 1px at 46% 22%, var(--dim), transparent),
      radial-gradient(1px 1px at 58% 5%, var(--dim), transparent),
      radial-gradient(1px 1px at 71% 27%, var(--dim), transparent),
      radial-gradient(1px 1px at 86% 10%, var(--dim), transparent),
      radial-gradient(1px 1px at 94% 36%, var(--dim), transparent);
    background-size: 100% 520px;
  }
  .stars i:nth-child(2) {
    background:
      radial-gradient(1.5px 1.5px at 12% 20%, var(--star), transparent),
      radial-gradient(1.5px 1.5px at 27% 44%, var(--dim), transparent),
      radial-gradient(1.5px 1.5px at 52% 14%, var(--star), transparent),
      radial-gradient(1.5px 1.5px at 66% 40%, var(--dim), transparent),
      radial-gradient(1.5px 1.5px at 79% 18%, var(--star), transparent),
      radial-gradient(1.5px 1.5px at 91% 52%, var(--dim), transparent);
    background-size: 100% 760px;
  }
  /* a few bright ones breathe; with reduced motion they simply stay lit */
  .stars i:nth-child(3) {
    background:
      radial-gradient(2px 2px at 23% 6%, var(--after-ink), transparent),
      radial-gradient(2px 2px at 63% 30%, var(--after-ink), transparent),
      radial-gradient(2px 2px at 88% 4%, var(--after-ink), transparent),
      radial-gradient(2px 2px at 41% 58%, var(--after-ink), transparent);
    background-size: 100% 900px;
  }
  @media (prefers-reduced-motion: no-preference) {
    .stars i:nth-child(3) {
      animation: twinkle 5s ease-in-out infinite;
    }
  }
  @keyframes twinkle {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  /* ── 1 · how it starts ───────────────────────────────────────────── */
  .head {
    display: grid;
    gap: 14px;
    max-width: 640px;
    padding-top: calc(272px - clamp(64px, 9vw, 128px));
  }
  .head .t-lede {
    margin-top: 4px;
  }

  .steps {
    --lamp: 88px;
    --path: color-mix(in srgb, var(--after-ink) 30%, transparent);
    position: relative;
    display: grid;
    gap: 28px;
    margin: clamp(32px, 5vw, 56px) 0 0;
    padding: 0;
    list-style: none;
  }
  .step {
    position: relative;
    display: grid;
    grid-template-columns: var(--lamp) minmax(0, 1fr);
    column-gap: 20px;
    align-items: start;
  }
  /* the path between the lamps: dotted, like the order's journey in the app */
  .step:not(:last-child)::after {
    content: '';
    position: absolute;
    left: calc(var(--lamp) / 2 - 1px);
    top: calc(var(--lamp) + 8px);
    height: calc(100% - var(--lamp) + 28px - 16px);
    border-left: 2px dotted var(--path);
  }
  .lamp {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--lamp);
    aspect-ratio: 1;
    border-radius: 50%;
    /* a lit kitchen window in the dark: the only warm light in the section, so Duá's forest green reads */
    background: radial-gradient(
      circle at 50% 42%,
      var(--after-ink) 0 55%,
      color-mix(in srgb, var(--after-ink) 88%, var(--after-muted)) 100%
    );
    box-shadow:
      0 0 0 6px color-mix(in srgb, var(--after-ink) 6%, transparent),
      0 0 48px color-mix(in srgb, var(--after-ink) 16%, transparent);
  }
  .lamp :global(.step-dua) {
    width: 86%;
  }
  .num {
    position: absolute;
    top: -2px;
    left: calc(var(--lamp) - 30px);
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--sky-5);
    box-shadow: 0 0 0 1.5px var(--after-line);
    font: 600 15px/1 var(--font-display);
    color: var(--after-ink);
  }
  /* the first order is the moment the store comes alive: the only lime in the steps */
  .first-order .num {
    background: var(--spark);
    color: var(--on-spark);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--spark) 22%, transparent);
  }
  .step-copy {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding-top: 8px;
  }
  .step-copy p {
    color: var(--ink-muted);
    max-width: 36ch;
  }

  @media (max-width: 399px) {
    .steps {
      --lamp: 72px;
    }
    .step {
      column-gap: 16px;
    }
    .num {
      left: calc(var(--lamp) - 24px);
      width: 28px;
      height: 28px;
      font-size: 14px;
    }
  }

  @media (min-width: 900px) {
    .steps {
      --lamp: clamp(120px, 11vw, 150px);
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: clamp(28px, 4vw, 56px);
    }
    .step {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto;
      justify-items: center;
      text-align: center;
      row-gap: 20px;
      align-items: start;
    }
    .step:not(:last-child)::after {
      left: calc(50% + var(--lamp) / 2 + 12px);
      top: calc(var(--lamp) / 2);
      width: calc(100% - var(--lamp) - 24px + clamp(28px, 4vw, 56px));
      height: 0;
      border-left: 0;
      border-top: 2px dotted var(--path);
    }
    .num {
      top: 6px;
      left: calc(50% + var(--lamp) / 2 - 40px);
      width: 36px;
      height: 36px;
      font-size: 16px;
    }
    .step-copy {
      justify-items: center;
      padding-top: 0;
    }
  }

  /* ── 2 · questions ───────────────────────────────────────────────── */
  .faq {
    display: grid;
    gap: 28px;
    margin-top: clamp(48px, 6vw, 72px);
    padding-top: clamp(40px, 5vw, 56px);
    border-top: 1px solid var(--after-line);
    scroll-margin-top: 88px;
  }
  .faq-head {
    display: grid;
    gap: 10px;
    align-content: start;
  }
  .faq-lamp {
    display: none;
  }
  .faq-head p {
    max-width: 34ch;
    color: var(--ink-muted);
  }
  @media (min-width: 1000px) {
    .faq {
      grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
      gap: 64px;
    }
    .faq-head {
      position: sticky;
      top: 104px;
    }
    .faq-lamp {
      display: grid;
      width: 120px;
      margin-bottom: 14px;
    }
  }

  details {
    border-bottom: 1px solid var(--after-line);
  }
  details:first-child {
    border-top: 1px solid var(--after-line);
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 64px;
    padding: 14px 4px;
    cursor: pointer;
    list-style: none;
    font: 600 1.125rem/1.35 var(--font-display);
    letter-spacing: -0.01em;
    color: var(--after-ink);
    border-radius: 8px;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover .plus {
    background: var(--after-card);
  }
  .plus {
    position: relative;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px var(--after-line);
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .plus::before,
  .plus::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 12px;
    height: 2px;
    margin: -1px 0 0 -6px;
    border-radius: 2px;
    background: currentColor;
    transition: transform var(--duration-smooth) var(--ease-soft);
  }
  .plus::after {
    transform: rotate(90deg);
  }
  details[open] .plus::after {
    transform: rotate(0deg);
  }
  .answer {
    padding: 0 8px 22px 4px;
    max-width: 60ch;
    color: var(--ink-muted);
  }
  @media (min-width: 768px) {
    .answer {
      padding-right: 48px;
    }
  }
  /* smooth open where the browser can animate to auto height; elsewhere it just opens */
  @supports (interpolate-size: allow-keywords) {
    details {
      interpolate-size: allow-keywords;
    }
    details::details-content {
      height: 0;
      overflow: clip;
      transition:
        height var(--duration-smooth) var(--ease-soft),
        content-visibility var(--duration-smooth) allow-discrete;
    }
    details[open]::details-content {
      height: auto;
    }
  }

  /* ── 3 · good night ──────────────────────────────────────────────── */
  .close {
    display: grid;
    justify-items: center;
    text-align: center;
    margin-top: clamp(56px, 7vw, 88px);
    padding-bottom: clamp(8px, 2vw, 24px);
  }
  .moment {
    max-width: 16ch;
    color: var(--after-ink);
    text-wrap: balance;
  }
  .cta {
    display: grid;
    justify-items: center;
    gap: 14px;
    margin-top: 36px;
  }
  .plans {
    font-size: 15px;
    color: var(--after-ink);
  }
  .follow {
    font-size: 15px;
    color: var(--ink-muted);
  }
  .follow a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding-inline: 4px;
    color: var(--after-ink);
    font-weight: 600;
    text-decoration-color: color-mix(in srgb, var(--spark) 70%, transparent);
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
  }
  .follow a:hover {
    text-decoration-color: var(--spark);
  }
</style>
