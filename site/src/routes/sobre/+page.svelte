<script lang="ts">
  import Band from '$lib/components/Band.svelte';
  import Closing from '$lib/components/Closing.svelte';
  import Dua from '$lib/components/Dua.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import Header from '$lib/components/Header.svelte';
  import NextReads from '$lib/components/NextReads.svelte';
  import Prose from '$lib/components/Prose.svelte';
  import Seo from '$lib/components/Seo.svelte';
  import { site } from '$lib/content';
  import { niches } from '$lib/pages';
  import { abs, breadcrumbs } from '$lib/seo';

  // Who Venduá is, for people and for search engines: the name and how it's typed without the
  // accent, what it does, for whom, and that sign-up is open. The card is the same receipt device
  // as the privacy page.
  const path = '/sobre/';
  const title = 'O que é a Venduá';
  const description =
    'A Venduá, ou vendua sem acento, é a loja online com app de pedidos para doceiras, marmitarias, hamburguerias e padarias. O que ela faz, para quem é e como começar.';
  const crumbs = [{ name: 'Início', path: '/' }];
  const schema = [
    breadcrumbs([...crumbs, { name: title, path }]),
    {
      '@type': 'AboutPage',
      '@id': abs(path),
      url: abs(path),
      name: title,
      description,
      inLanguage: 'pt-BR',
      mainEntity: { '@id': abs('/#organizacao') },
    },
  ];

  const card = [
    { item: 'Nome', value: 'Venduá' },
    { item: 'Sem acento', value: 'vendua' },
    { item: 'Site', value: 'vendua.com.br' },
    { item: 'Cada loja', value: 'seunome.vendua.com.br' },
    { item: 'Mascote', value: 'o Duá, um tamanduá' },
    { item: 'Cadastro', value: 'aberto' },
  ];
</script>

<Seo title="O que é a Venduá (vendua.com.br)" {description} {path} {schema} />
<Header home={false} overlay />

<main id="conteudo">
  <Band
    {crumbs}
    {title}
    lede="Uma loja online com a sua cara e um app no celular para tocar o dia de quem vende comida: pedidos, cardápio, horários e Pix. Para doceiras, marmitarias, hamburguerias e padarias."
  >
    {#snippet art()}<Dua pose="boas-vindas" size={300} eager />{/snippet}
  </Band>

  <div class="wrap body">
    <aside class="receipt" aria-labelledby="ficha">
      <h2 id="ficha" class="receipt-title">A Venduá numa ficha</h2>
      <dl>
        {#each card as r (r.item)}
          <div class="line">
            <dt>{r.item}</dt>
            <dd>{r.value}</dd>
          </div>
        {/each}
      </dl>
    </aside>

    <div class="text">
      <Prose>
        <h2 id="nome">Venduá, ou vendua</h2>
        <p>
          O nome se escreve com acento no a: Venduá. Na internet, onde endereço não leva acento, ele
          vira <strong>vendua</strong>: o site é vendua.com.br e cada loja ganha o seu endereço em
          seunome.vendua.com.br. Se você procurou por vendua, sem acento, chegou ao lugar certo.
        </p>
        <p>
          O tamanduá que aparece pelo site é o Duá. Ele monta a loja com você no primeiro dia,
          aparece no app e, no Venduá Bandeira, é o vendedor com IA no WhatsApp da loja.
        </p>

        <h2 id="o-que-faz">O que a Venduá faz</h2>
        <p>Três coisas, que andam juntas:</p>
        <ul>
          <li>
            <strong>A loja online.</strong> O cardápio com fotos e preços, num link que o cliente abre
            no navegador, sem baixar nada e sem criar conta. Ele escolhe, paga com Pix, cartão ou dinheiro
            e acompanha o pedido pela mesma página.
          </li>
          <li>
            <strong>O app da loja.</strong> No celular de quem vende, instalado pelo navegador. O pedido
            toca, você aceita da notificação, e dali cuida de horários, cardápio, entrega, cupons, equipe
            e relatórios.
          </li>
          <li>
            <strong>O Duá.</strong> No Venduá Bandeira, ele responde os clientes no WhatsApp da loja e
            fecha o pedido com eles, sempre com os preços e os horários da loja. Para o cliente, ele se
            apresenta como assistente virtual da loja, nunca como uma pessoa.
          </li>
        </ul>
        <p>
          O Pix cai direto na conta do Mercado Pago da loja. A Venduá não cobra comissão por pedido:
          a loja paga o plano do mês, e o Mercado Pago desconta a taxa dele de cada pagamento.
        </p>

        <h2 id="para-quem">Para quem é</h2>
        <p>
          Para quem vende comida feita na própria cozinha e quer pedido organizado sem virar
          especialista em tecnologia. Cada negócio vende de um jeito, e a loja acompanha:
        </p>
        <ul>
          {#each niches as n (n.path)}
            <li><a href={n.path}>{n.label}</a></li>
          {/each}
        </ul>

        <h2 id="como-esta">Em que pé está</h2>
        <p>
          A Venduá está aberta: qualquer pessoa cria a sua loja pelo celular, respondendo 8
          perguntas ao Duá, e em cerca de uma hora ela está no ar. Os planos, com o que cada um
          traz, estão lado a lado <a href="/#preco">na página inicial</a>.
        </p>
        <p>
          Novidades saem no Instagram,
          <a href={site.instagram.url} rel="noopener" target="_blank"
            >{site.instagram.handle}<span class="sr-only"> (abre em nova aba)</span></a
          >. E para quem quer vender melhor, com ou sem a Venduá, tem os
          <a href="/guias/">guias</a>.
        </p>
      </Prose>
    </div>
  </div>

  <Closing title="A próxima loja no ar pode ser a sua.">
    <NextReads current={path} />
  </Closing>
</main>
<Footer />

<style>
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 40px;
    padding-block: 16px clamp(64px, 9vw, 112px);
  }

  .receipt {
    align-self: start;
    width: 100%;
    max-width: 30rem;
    padding: 22px 22px 14px;
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
    color: var(--ink);
    text-align: right;
    overflow-wrap: anywhere;
  }

  @media (min-width: 1024px) {
    .body {
      grid-template-columns: minmax(0, 40rem) 320px;
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
    .text {
      grid-column: 1;
      grid-row: 1;
    }
  }
</style>
