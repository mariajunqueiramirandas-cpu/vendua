<script lang="ts">
  import Dua from '$lib/components/Dua.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';
  import Section from '$lib/components/Section.svelte';
  import Soon from '$lib/components/Soon.svelte';
  import Tablet from '$lib/components/Tablet.svelte';
  import { store } from '$lib/content';

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
    'Loja com a sua cara',
    'App de pedidos no celular',
    'Pix direto na sua conta do Mercado Pago',
    'Cardápio, estoque e encomendas',
    'Entrega e retirada',
    'Cupons, fidelidade e lista de espera',
    'Relatórios',
    'Equipe',
    'Endereço próprio',
  ];
  const pad = (n: number) => String(n).padStart(2, '0');
</script>

<Section
  id="sua-loja"
  hour="15h"
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
      <p class="eyebrow t-label">Pra abrir</p>
      <h3 class="t-title-1">8 perguntinhas, uma de cada vez.</h3>
      <p class="body">
        O Duá pergunta, você responde no seu tempo. A cada resposta, a sua loja vai aparecendo ao
        lado, do jeito que o cliente vai ver. Cansou? Pode sair: ele guarda tudo.
      </p>
      <ol class="steps" aria-label="8 perguntas">
        {#each Array(8) as _, i (i)}
          <li class:done={i < 3} class:now={i === 3}><span class="sr-only">{i + 1}</span></li>
        {/each}
      </ol>
      <p class="live t-label">
        <svg viewBox="0 0 24 24" aria-hidden="true"
          ><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9.5 3h5" /></svg
        >
        Loja no ar em cerca de 1 hora
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
      <p class="eyebrow t-label">No dia a dia</p>
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
          <p class="aside">ou o seu próprio domínio, se você já tiver um.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- 3 · price -->
  <div class="part price" id="preco" role="region" aria-labelledby="preco-t">
    <div class="copy">
      <p class="eyebrow t-label">Quanto custa</p>
      <h3 id="preco-t" class="t-display price-t">Tudo isso numa loja só.</h3>
      <p class="body">Estamos preparando as primeiras lojas, e o preço sai junto com elas.</p>
      <Soon size="lg" note="O preço sai com as primeiras lojas." />
    </div>

    <div class="stand">
      <Dua pose="publicar" size={220} class="price-dua" />
      <div class="paper">
        <div class="receipt">
          <p class="brand">venduá</p>
          <h4 class="rt">O que vem na sua loja</h4>
          <ul role="list">
            {#each receipt as item, i (item)}
              <li>
                <span class="n tnum" aria-hidden="true">{pad(i + 1)}</span>
                <span class="item">{item}</span>
                <i aria-hidden="true"></i>
                <em>incluso</em>
              </li>
            {/each}
          </ul>
          <p class="total">
            <span>Total por mês</span>
            <i aria-hidden="true"></i>
            <strong>em breve</strong>
          </p>
          <p class="foot tnum">{pad(receipt.length)} itens · todos inclusos</p>
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
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-muted);
  }
  .eyebrow::before {
    content: '';
    width: 18px;
    height: 2px;
    border-radius: 2px;
    background: currentColor;
  }
  h3 {
    margin-top: 10px;
    max-width: 18ch;
  }
  .body {
    margin-top: 16px;
    max-width: 44ch;
    color: var(--ink);
  }

  /* ── 1 · open ─────────────────────────────────────────────────────── */
  .steps {
    list-style: none;
    display: flex;
    gap: 8px;
    margin: 26px 0 0;
    padding: 0;
  }
  .steps li {
    width: 26px;
    height: 8px;
    border-radius: 999px;
    background: var(--line-strong);
  }
  .steps li.done {
    background: var(--primary);
  }
  .steps li.now {
    background: var(--spark);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 30%, transparent);
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin-top: 22px;
    padding: 8px 14px 8px 10px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow:
      var(--shadow-e1),
      0 0 0 1px var(--line);
  }
  .live svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

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
  @media (min-width: 640px) {
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
  .price .body {
    margin-bottom: 28px;
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
    letter-spacing: 0.04em;
    text-transform: uppercase;
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
  .total {
    display: flex;
    align-items: last baseline;
    gap: 8px;
  }
  .n {
    align-self: first baseline;
    flex: none;
    width: 2ch;
    font: 600 0.75rem/1 var(--font-display);
    color: var(--ink-muted);
  }
  .item {
    min-width: 0;
  }
  .receipt i {
    flex: 1 0 14px;
    border-bottom: 2px dotted var(--line-strong);
    transform: translateY(-4px);
  }
  .receipt em {
    flex: none;
    font: 600 0.8125rem/1 var(--font-display);
    font-style: normal;
    color: var(--success);
  }
  .total {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 2px dashed var(--line-strong);
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
  .foot {
    margin-top: 16px;
    text-align: center;
    font: 500 0.75rem/1.2 var(--font-display);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-muted);
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
