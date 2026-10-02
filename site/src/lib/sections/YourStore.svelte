<script lang="ts">
  import Dua from '$lib/components/Dua.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';
  import Section from '$lib/components/Section.svelte';
  import Tablet from '$lib/components/Tablet.svelte';
  import { plans, signup, store } from '$lib/content';

  // the address the `loja` screenshot shows
  const address = 'bolosdanena.vendua.com.br';

  const points = [
    {
      title: 'Cole a lista do WhatsApp',
      text: 'Aquela lista que você já manda pros clientes vira os produtos do cardápio. Depois é só pôr as fotos.',
    },
    {
      title: 'Adicionais, kits e esgotado hoje',
      text: 'Cobertura extra, kit festa, bolo por encomenda. Acabou a fornada? Um toque em esgotado hoje.',
    },
    {
      title: 'Horários e dias especiais',
      text: 'Fecha na segunda, abre mais cedo no sábado, horário diferente no feriado. Você ajusta pelo celular.',
    },
    {
      title: 'Entrega por bairro',
      text: 'Cada bairro com a sua taxa, ou um raio no mapa. Pedido mínimo, entrega por conta da loja acima de um valor, e retirada no balcão.',
    },
  ];

  const receipt = [
    'Loja online com o seu nome',
    'App de pedidos no celular',
    'Pix na sua conta do Mercado Pago',
    'Cardápio, estoque e encomendas',
    'Entrega e retirada',
    'Cupons, fidelidade e lista de espera',
    'Relatórios',
    'Equipe',
  ];

  // what each plan adds, in the user's words (never more)
  const tiers = [
    {
      plan: plans.basic,
      text: 'Loja em seunome.vendua.com.br, com o visual padrão da Venduá. Sem domínio próprio e sem site personalizado.',
    },
    {
      plan: plans.pro_plus,
      text: 'Domínio próprio e um site feito pelo nosso agente de IA.',
    },
  ];
</script>

<Section
  id="sua-loja"
  tone="day"
  sky="linear-gradient(180deg, var(--sky-3), var(--sky-4))"
  labelledby="sua-loja-t"
>
  <header class="head">
    <h2 id="sua-loja-t" class="t-display">A loja é sua.</h2>
    <p class="t-lede">
      Com o seu nome, as suas cores e o seu cardápio. Você monta conversando com o Duá, e em cerca
      de uma hora ela já está no ar.
    </p>
  </header>

  <!-- 1 · the store assembles while Duá asks -->
  <div class="part open">
    <div class="copy">
      <h3 class="t-title-1">8 perguntinhas, uma de cada vez.</h3>
      <p class="body">
        O Duá pergunta, você responde no seu tempo. A cada resposta, a sua loja vai aparecendo ao
        lado, do jeito que o cliente vai ver. Cansou? Pode sair: ele guarda tudo.
      </p>
    </div>

    <div class="device">
      <div class="big">
        <Tablet>
          <Screen
            key="boasVindasDesktop"
            sizes="(max-width: 1023px) 90vw, 700px"
            alt="O começo da loja no computador: o Duá diz oi para a {store.owner} e conta que são 8 perguntinhas. Ao lado, a {store.name} já aparece ao vivo, com os bolos e os preços."
          />
        </Tablet>
      </div>
      <div class="small">
        <Phone width={260} time="15:04">
          <Screen
            key="boasVindas"
            sizes="260px"
            alt="O começo da loja no celular: o Duá se apresenta para a {store.owner} e conta que são 8 perguntinhas, uma de cada vez."
          />
        </Phone>
      </div>
    </div>
  </div>

  <!-- 2 · menu and hours, on the phone -->
  <div class="part daily">
    <div class="phones">
      <div class="ph ph-a">
        <Phone time="15:10" style="--w: 100%">
          <Screen
            key="cardapio"
            sizes="(max-width: 560px) 46vw, 260px"
            alt="O cardápio da {store.name} no app: 14 produtos em 4 categorias, com bolo de cenoura com brigadeiro a R$ 45,00 e bolo de chocolate molhadinho a R$ 48,00."
          />
        </Phone>
      </div>
      <div class="ph ph-b">
        <Phone time="15:12" style="--w: 100%">
          <Screen
            key="loja"
            sizes="(max-width: 560px) 46vw, 260px"
            alt="A tela Loja no app, com o endereço {address} e os horários: fechado na segunda, das 7h às 21h de terça a sábado."
          />
        </Phone>
      </div>
    </div>

    <div class="copy">
      <h3 class="t-title-1">Seu cardápio e seus horários, no celular.</h3>
      <ul class="points" role="list">
        {#each points as p (p.title)}
          <li>
            <h4>{p.title}</h4>
            <p>{p.text}</p>
          </li>
        {/each}
      </ul>

      <div class="look">
        <Dua pose="personalizar" size={120} class="look-dua" />
        <div>
          <h4>Mexa na aparência sem medo</h4>
          <p>
            Troque cores, fotos e textos e veja exatamente como a loja fica antes de publicar. E ela
            tem endereço próprio:
          </p>
          <p class="addr tnum"><span aria-hidden="true" class="lock"></span>{address}</p>
          <p class="aside">ou o seu próprio domínio, no plano PRO+.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- 3 · price -->
  <div class="part price" id="preco" role="region" aria-labelledby="preco-t">
    <div class="copy">
      <h3 id="preco-t" class="t-display price-t">Tudo isso numa loja só.</h3>
      <p class="body">
        Da primeira pergunta do Duá ao último pedido da noite, vem tudo junto. Você paga só o plano:
        a Venduá não cobra nada por pedido.
      </p>
      <p class="pay">
        Pix todo mês ou cartão, pelo Mercado Pago. No {plans.basic.short}, você começa com {plans
          .basic.trial} e só paga depois.
      </p>
    </div>

    <div class="stand">
      <Dua pose="publicar" size={220} class="price-dua" />
      <div class="paper">
        <div class="receipt">
          <p class="brand">venduá</p>
          <h4 class="rt">O que vem na sua loja</h4>
          <ul role="list">
            {#each receipt as item (item)}
              <li>
                <span class="item">{item}</span>
                <i aria-hidden="true"></i>
                <em>incluso</em>
              </li>
            {/each}
          </ul>

          <h4 class="choose">Escolha o plano</h4>
          <ul class="tiers" role="list">
            {#each tiers as t (t.plan.id)}
              <li class="tier">
                <p class="total">
                  <span>{t.plan.name}</span>
                  <i aria-hidden="true"></i>
                  <strong class="tnum">{t.plan.price}<small>/mês</small></strong>
                </p>
                {#if t.plan.trial}
                  <p class="trial">{t.plan.trial}, sem cartão</p>
                {/if}
                <p class="what">{t.text}</p>
                <a class="take" href={signup(t.plan.id)}
                  >Criar loja no {t.plan.short}<i class="go" aria-hidden="true"></i></a
                >
              </li>
            {/each}
          </ul>

          <p class="fee">
            <span>Taxa da Venduá por pedido</span>
            <i aria-hidden="true"></i>
            <em>nenhuma</em>
          </p>
          <p class="fine">O Mercado Pago fica com a tarifa dele em cada pagamento.</p>
        </div>
      </div>
    </div>
  </div>
</Section>

<style>
  .head {
    display: grid;
    gap: 18px;
    max-width: 640px;
    margin-top: 28px;
  }

  .part {
    display: grid;
    gap: clamp(36px, 5vw, 64px);
    align-items: center;
    margin-top: clamp(56px, 8vw, 112px);
  }
  .copy {
    display: grid;
    justify-items: start;
    align-content: start;
    min-width: 0;
  }
  h3 {
    max-width: 18ch;
  }
  .body {
    margin-top: 16px;
    max-width: 44ch;
    color: var(--ink);
  }

  /* ── 1 · open ─────────────────────────────────────────────────────── */
  .device {
    display: grid;
    justify-items: center;
    min-width: 0;
  }
  .big {
    display: none;
    width: 100%;
  }
  .small {
    display: flex;
    justify-content: center;
    width: 100%;
  }
  @media (min-width: 768px) {
    .big {
      display: block;
    }
    .small {
      display: none;
    }
  }
  @media (min-width: 1024px) {
    .open {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    }
  }
  /* only bleed past the column where the gutter has room for it */
  @media (min-width: 1280px) {
    .big {
      width: 108%;
      margin-right: -8%;
    }
  }

  /* ── 2 · daily ────────────────────────────────────────────────────── */
  .phones {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: min(100%, 540px);
    justify-self: center;
    padding-block: 12px 24px;
  }
  .ph {
    min-width: 0;
  }
  .ph-a {
    rotate: -3deg;
    margin-right: -6%;
    z-index: 1;
  }
  .ph-b {
    rotate: 3deg;
    margin-left: -6%;
    margin-top: 16%;
  }
  .points {
    list-style: none;
    display: grid;
    gap: 22px 32px;
    margin: 28px 0 0;
    padding: 0;
  }
  /* two columns only when the copy has the width: not while it shares the row with the phones at 1024 */
  @media (min-width: 640px) and (max-width: 1023px), (min-width: 1280px) {
    .points {
      grid-template-columns: 1fr 1fr;
    }
  }
  .points li {
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  h4 {
    font: 600 1.0625rem/1.35 var(--font-display);
    letter-spacing: -0.01em;
  }
  .points p {
    margin-top: 6px;
    font-size: 0.9688rem;
    line-height: 1.55;
  }
  .look {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    margin-top: 32px;
    padding: 20px 20px 22px 14px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-e2);
    width: 100%;
  }
  @media (max-width: 479px) {
    .look {
      flex-direction: column;
      gap: 4px;
      padding: 16px 20px 22px;
    }
    .addr {
      font-size: 0.875rem !important;
    }
  }
  .look :global(.look-dua) {
    flex: none;
    width: clamp(72px, 20vw, 108px);
    margin-top: -4px;
  }
  .look > div {
    min-width: 0;
  }
  .look p {
    margin-top: 6px;
    font-size: 0.9688rem;
    line-height: 1.55;
  }
  .addr {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    margin-top: 12px !important;
    padding: 8px 14px 8px 12px;
    border-radius: 999px;
    background: var(--spark-soft);
    color: var(--ink);
    font: 600 0.9375rem/1.2 var(--font-display) !important;
    white-space: nowrap;
  }
  .lock {
    flex: none;
    width: 10px;
    height: 8px;
    margin-top: 4px;
    border-radius: 2px;
    background: currentColor;
    position: relative;
  }
  .lock::before {
    content: '';
    position: absolute;
    left: 1.5px;
    bottom: 6px;
    width: 7px;
    height: 6px;
    border: 1.8px solid currentColor;
    border-bottom: 0;
    border-radius: 4px 4px 0 0;
    box-sizing: border-box;
  }
  .aside {
    color: var(--ink-muted);
    font-size: 0.875rem !important;
  }
  @media (min-width: 1024px) {
    .daily {
      grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    }
  }

  /* ── 3 · price ────────────────────────────────────────────────────── */
  .price {
    padding: clamp(28px, 5vw, 56px);
    border-radius: var(--radius-xl);
    background: color-mix(in srgb, var(--surface) 55%, transparent);
    box-shadow: 0 0 0 1px var(--line);
  }
  .price-t {
    max-width: 12ch;
  }
  .pay {
    margin-top: 14px;
    max-width: 44ch;
    color: var(--ink-muted);
    font-size: 0.9688rem;
  }
  @media (min-width: 1100px) {
    .price {
      grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    }
  }

  .stand {
    position: relative;
    justify-self: center;
    width: min(100%, 420px);
    padding-top: 96px;
  }
  .stand :global(.price-dua) {
    position: absolute;
    top: -8px;
    right: -6px;
    width: 150px;
    z-index: 2;
    filter: drop-shadow(0 10px 14px rgb(18 60 50 / 0.18));
  }
  @media (min-width: 1100px) {
    .stand {
      width: min(100%, 560px);
      padding-top: 0;
      padding-left: 150px;
    }
    .stand :global(.price-dua) {
      top: auto;
      bottom: -8px;
      right: auto;
      left: -14px;
      width: 172px;
    }
  }

  @media (max-width: 479px) {
    .price {
      padding: 28px 14px 20px;
      margin-inline: calc(var(--gutter) * -0.5);
    }
    .price .copy {
      padding-inline: 8px;
    }
    .paper {
      rotate: 0deg !important;
    }
    .receipt {
      padding-inline: 14px !important;
      font-size: 0.875rem !important;
    }
  }
  .total span {
    white-space: nowrap;
  }

  /* the drop shadow sits on the wrapper so the torn edge casts it too */
  .paper {
    filter: drop-shadow(0 2px 2px rgb(18 60 50 / 0.08))
      drop-shadow(0 18px 28px rgb(18 60 50 / 0.14));
    rotate: -1.5deg;
  }
  .receipt {
    --tooth: 14px;
    padding: 26px 22px calc(26px + var(--tooth));
    background: var(--surface);
    border-radius: 6px 6px 0 0;
    font: 500 0.9375rem/1.35 var(--font-sans);
    color: var(--ink);
    -webkit-mask:
      linear-gradient(#000 0 0) top / 100% calc(100% - var(--tooth)) no-repeat,
      conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom /
        var(--tooth) calc(var(--tooth) / 2) repeat-x;
    mask:
      linear-gradient(#000 0 0) top / 100% calc(100% - var(--tooth) / 2) no-repeat,
      conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom /
        var(--tooth) calc(var(--tooth) / 2) repeat-x;
  }
  .brand {
    font: 700 1.125rem/1 var(--font-display);
    letter-spacing: -0.02em;
    text-align: center;
  }
  .rt {
    margin-top: 6px;
    text-align: center;
    font: 500 0.8125rem/1.3 var(--font-sans);
    color: var(--ink-muted);
    padding-bottom: 16px;
    border-bottom: 2px dashed var(--line-strong);
  }
  .receipt ul {
    list-style: none;
    display: grid;
    gap: 10px;
    margin: 16px 0 0;
    padding: 0;
  }
  .receipt li,
  .total,
  .fee {
    display: flex;
    align-items: last baseline;
    gap: 8px;
  }
  .item {
    min-width: 0;
  }
  .receipt i:not(.go) {
    flex: 1 0 14px;
    border-bottom: 2px dotted var(--line-strong);
    transform: translateY(-4px);
  }
  .receipt em,
  .fee em {
    flex: none;
    font: 600 0.8125rem/1 var(--font-display);
    font-style: normal;
    color: var(--success);
  }
  .choose {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 2px dashed var(--line-strong);
    text-align: center;
    font: 500 0.8125rem/1.3 var(--font-sans);
    color: var(--ink-muted);
  }
  .receipt .tiers {
    gap: 0;
    margin-top: 4px;
  }
  .receipt .tier {
    display: grid;
    gap: 6px;
    padding-block: 14px 12px;
  }
  .tier + .tier {
    border-top: 1px dotted var(--line-strong);
  }
  .total {
    font: 700 1.0625rem/1.2 var(--font-display);
  }
  .total strong {
    flex: none;
    padding: 5px 10px;
    border-radius: 6px;
    background: var(--spark);
    color: var(--on-spark);
    font-weight: 700;
  }
  .total small {
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .trial {
    justify-self: end;
    margin-top: -2px;
    font: 600 0.8125rem/1.2 var(--font-display);
    color: var(--success);
  }
  .what {
    max-width: 38ch;
    color: var(--ink-muted);
    font-size: 0.875rem;
    line-height: 1.45;
  }
  .take {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    margin-top: 2px;
    padding: 0 14px;
    border-radius: var(--radius-md);
    box-shadow: inset 0 0 0 1.5px var(--ink);
    color: var(--ink);
    font: 600 0.9375rem/1 var(--font-sans);
    text-decoration: none;
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .take:hover {
    background: var(--spark-soft);
  }
  .go {
    position: relative;
    flex: none;
    width: 12px;
    height: 2px;
    border-radius: 2px;
    background: currentColor;
    transition: translate var(--duration-quick) var(--ease-soft);
  }
  .go::after {
    content: '';
    position: absolute;
    right: -1px;
    top: -3px;
    width: 7px;
    height: 7px;
    border: solid currentColor;
    border-width: 2px 2px 0 0;
    border-radius: 1px;
    rotate: 45deg;
  }
  .take:hover .go {
    translate: 3px 0;
  }
  .fee {
    margin-top: 6px;
    padding-top: 14px;
    border-top: 2px dashed var(--line-strong);
  }
  .fee span {
    min-width: 0;
  }
  .fine {
    margin-top: 8px;
    color: var(--ink-muted);
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  @media (prefers-color-scheme: dark) {
    .receipt {
      background: var(--surface-raised);
    }
    .paper {
      filter: drop-shadow(0 18px 28px rgb(0 0 0 / 0.45));
    }
    .price {
      background: color-mix(in srgb, var(--surface) 60%, transparent);
    }
    .stand :global(.price-dua) {
      filter: drop-shadow(0 0 20px color-mix(in srgb, var(--spark) 18%, transparent))
        drop-shadow(0 10px 14px rgb(0 0 0 / 0.4));
    }
  }

  /* the receipt comes out of the printer as it scrolls into view; without support it just sits there */
  @media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: view()) {
      .receipt {
        animation: print linear both;
        animation-timeline: view();
        animation-range: entry 10% cover 45%;
      }
    }
  }
  @keyframes print {
    from {
      transform: translateY(-28px);
    }
    to {
      transform: none;
    }
  }
</style>
