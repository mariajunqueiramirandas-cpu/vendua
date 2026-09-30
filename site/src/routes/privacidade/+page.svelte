<script lang="ts">
  import Dua from '$lib/components/Dua.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import Header from '$lib/components/Header.svelte';
  import Seo from '$lib/components/Seo.svelte';
  import { site } from '$lib/content';

  // What the site keeps about a visitor, as a receipt (the same device the price block uses).
  const receipt = [
    { item: 'Dados pessoais', value: 'nenhum' },
    { item: 'Formulários', value: 'nenhum' },
    { item: 'Cookies', value: 'nenhum' },
    { item: 'Análises e rastreadores', value: 'nenhum' },
    { item: 'Serviços de terceiros', value: 'nenhum' },
  ];
</script>

<Seo
  title="Privacidade · Venduá"
  description="O site da Venduá não pede dados, não usa cookies e não tem rastreadores. Tudo o que acontece quando você passa por aqui, em palavras simples."
  path="/privacidade/"
  noindex
/>
<Header home={false} overlay />

<main id="conteudo">
  <div class="band">
    <div class="wrap band-row">
      <div class="intro">
        <p class="t-label kicker">Privacidade</p>
        <h1 class="t-display">Sua visita fica só com você.</h1>
        <p class="t-lede">
          Este site não pede nada, não guarda nada e não segue ninguém. Aqui está, em palavras
          simples, tudo o que acontece quando você passa por aqui.
        </p>
      </div>
      <div class="guard" aria-hidden="true">
        <span class="halo"></span>
        <Dua pose="seguranca" size={260} eager class="guard-dua" />
      </div>
    </div>
  </div>

  <div class="wrap body">
    <aside class="receipt" aria-labelledby="recibo">
      <h2 id="recibo" class="receipt-title">O que o site guarda sobre você</h2>
      <dl>
        {#each receipt as r (r.item)}
          <div class="line">
            <dt>{r.item}</dt>
            <dd>{r.value}</dd>
          </div>
        {/each}
        <div class="line total">
          <dt>Total</dt>
          <dd><span class="chip">nada</span></dd>
        </div>
      </dl>
      <p class="receipt-note">
        Só quando uma página dá erro fica um registro técnico. Veja abaixo.
      </p>
    </aside>

    <article class="prose">
      <section aria-labelledby="coleta">
        <h2 id="coleta" class="t-title-2">Nada de cadastro por aqui</h2>
        <p>
          O site não tem formulário, campo de contato, login nem cadastro. Você lê, olha o Duá e vai
          embora. Nenhum dado seu é pedido, e nenhum é guardado.
        </p>
      </section>

      <section aria-labelledby="cookies">
        <h2 id="cookies" class="t-title-2">Sem cookies, sem rastreadores</h2>
        <p>
          Não usamos cookies. Também não há análise de audiência, pixel de anúncio, mapa de cliques
          ou qualquer outro rastreador. O site não grava nada no seu navegador.
        </p>
      </section>

      <section aria-labelledby="daqui">
        <h2 id="daqui" class="t-title-2">Tudo vem daqui mesmo</h2>
        <p>
          As letras, as imagens do app e o Duá são servidos pelo próprio vendua.com.br. Enquanto
          você está aqui, seu navegador não conversa com nenhum outro serviço.
        </p>
      </section>

      <section aria-labelledby="erros">
        <h2 id="erros" class="t-title-2">Quando algo dá errado</h2>
        <p>
          O servidor não anota as visitas que dão certo. Ele só registra os pedidos que falham, como
          uma página que não existe ou um erro nosso. Nesses casos ficam os dados técnicos de
          costume:
        </p>
        <ul class="ticks">
          <li>o endereço IP de onde veio o acesso;</li>
          <li>a data e a hora;</li>
          <li>o endereço que foi pedido e a resposta do servidor;</li>
          <li>o navegador usado e a página de origem, quando o navegador informa.</li>
        </ul>
        <p>Esses registros servem só para achar e consertar o problema.</p>
      </section>

      <section aria-labelledby="instagram">
        <h2 id="instagram" class="t-title-2">O link do Instagram</h2>
        <p>
          No rodapé tem um link para o nosso Instagram. Ao tocar nele, você sai daqui e passa a
          seguir a <a href="https://privacycenter.instagram.com/policy/" rel="noopener"
            >política de privacidade do Instagram</a
          >.
        </p>
      </section>

      <section aria-labelledby="lojas">
        <h2 id="lojas" class="t-title-2">Quando você cria uma loja</h2>
        <p>
          O cadastro da loja acontece no painel da Venduá, fora deste site: lá você informa o seu
          nome, o seu e-mail e o seu WhatsApp. Esta página fala só do site. Dúvidas sobre os dados
          da sua loja chegam pelos endereços abaixo.
        </p>
      </section>

      <section class="contact" aria-labelledby="contato">
        <h2 id="contato" class="t-title-2">Ficou alguma dúvida?</h2>
        <p>Escreva pra gente. Qualquer pedido sobre os seus dados também chega por aqui.</p>
        <ul class="mails">
          {#each site.emails as e (e)}
            <li><a href="mailto:{e}">{e}</a></li>
          {/each}
        </ul>
      </section>

      <p class="t-caption updated">Atualizada em setembro de 2026.</p>
    </article>
  </div>
</main>

<Footer />

<style>
  /* ── the dawn band: the header floats over it, like on the home page ── */
  .band {
    background: linear-gradient(180deg, var(--sky-0) 0%, var(--sky-1) 62%, var(--bg) 100%);
    padding-top: calc(var(--header-h) + env(safe-area-inset-top, 0px));
  }
  .band-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding-block: 40px 24px;
  }
  .intro {
    display: grid;
    gap: 16px;
    max-width: 34rem;
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
    background: var(--success);
  }
  .t-lede {
    color: var(--ink-muted);
  }

  .guard {
    position: relative;
    justify-self: center;
    display: grid;
    place-items: center;
    width: min(220px, 62vw);
    aspect-ratio: 1;
  }
  .halo {
    position: absolute;
    inset: 4%;
    border-radius: 50%;
    background: radial-gradient(
      circle closest-side,
      var(--surface) 0 91%,
      color-mix(in srgb, var(--spark) 45%, var(--surface)) 91.5% 99%,
      transparent 100%
    );
    box-shadow: var(--shadow-e1);
  }
  .guard :global(.guard-dua) {
    position: relative;
    width: 94%;
    translate: 0 -3%;
    filter: drop-shadow(0 10px 14px rgb(18 60 50 / 0.16));
    animation: stand 1.1s var(--ease-soft) 0.2s both;
  }
  @keyframes stand {
    from {
      transform: translateY(10px) rotate(-3deg);
    }
    to {
      transform: none;
    }
  }

  /* ── reading area ── */
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 40px;
    padding-block: 24px clamp(72px, 10vw, 128px);
  }

  .receipt {
    align-self: start;
    width: 100%;
    max-width: 30rem;
    padding: 22px 22px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-e2), var(--highlight);
    rotate: -0.6deg;
  }
  .receipt-title {
    font: 600 1.0625rem/1.35 var(--font-display);
    letter-spacing: -0.01em;
    margin-bottom: 12px;
  }
  dl {
    margin: 0;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding-block: 7px;
    font-size: 15px;
  }
  .line dt {
    color: var(--ink);
  }
  /* the dotted leader between item and value */
  .line::after {
    content: '';
    order: 1;
    flex: 1;
    min-width: 12px;
    border-bottom: 2px dotted var(--line-strong);
    translate: 0 -4px;
  }
  .line dd {
    order: 2;
    margin: 0;
    font-weight: 600;
    color: var(--success);
  }
  .total {
    margin-top: 8px;
    padding-top: 14px;
    border-top: 1.5px solid var(--line-strong);
    align-items: center;
  }
  .total dt {
    font: 600 1.0625rem/1 var(--font-display);
  }
  .total::after {
    border-bottom-color: transparent;
  }
  .chip {
    display: inline-block;
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--spark);
    color: var(--on-spark);
    font: 600 15px/1.2 var(--font-display);
  }
  .receipt-note {
    margin-top: 12px;
    font-size: 14px;
    line-height: 1.45;
    color: var(--ink-muted);
  }

  .prose {
    display: grid;
    gap: 36px;
    max-width: 38rem;
  }
  .prose section {
    display: grid;
    gap: 12px;
  }
  .prose h2 {
    color: var(--ink);
  }
  .prose p,
  .prose li {
    color: var(--ink);
    font-size: 1.0625rem;
    line-height: 1.7;
  }
  .prose a {
    text-decoration-color: color-mix(in srgb, var(--ink) 40%, transparent);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 4px;
    font-weight: 600;
  }
  .prose a:hover {
    text-decoration-color: currentColor;
  }
  .ticks {
    display: grid;
    gap: 6px;
    padding: 16px 18px;
    margin: 0;
    list-style: none;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }
  .ticks li {
    position: relative;
    padding-left: 22px;
  }
  .ticks li::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 0.72em;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 2px solid var(--ink-muted);
  }

  .contact {
    padding: 24px;
    border-radius: var(--radius-lg);
    background: var(--spark-soft);
  }
  .mails {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .mails a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    overflow-wrap: anywhere;
  }
  .prose .updated {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }

  @media (min-width: 768px) {
    .band-row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 48px;
      padding-block: 64px 40px;
    }
    .guard {
      width: 260px;
    }
  }
  @media (min-width: 1024px) {
    .band-row {
      padding-block: 88px 48px;
    }
    .guard {
      width: 300px;
      margin-right: 40px;
    }
    .body {
      grid-template-columns: minmax(0, 38rem) 320px;
      justify-content: space-between;
      column-gap: 64px;
      padding-top: 40px;
    }
    .receipt {
      grid-column: 2;
      grid-row: 1;
      position: relative;
      top: -56px;
    }
    .prose {
      grid-column: 1;
      grid-row: 1;
    }
  }

  @media (prefers-color-scheme: dark) {
    /* Duá is forest green: a warm lit disc keeps him readable on the night palette */
    .halo {
      background: radial-gradient(
        circle closest-side,
        var(--after-ink) 0 91%,
        color-mix(in srgb, var(--spark) 40%, var(--after-ink)) 91.5% 99%,
        transparent 100%
      );
      box-shadow: 0 0 60px color-mix(in srgb, var(--spark) 16%, transparent);
    }
    .guard :global(.guard-dua) {
      filter: drop-shadow(0 10px 14px rgb(0 0 0 / 0.3));
    }
    .line dd {
      color: var(--success);
    }
  }
</style>
