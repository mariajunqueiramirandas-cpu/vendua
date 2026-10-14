<script lang="ts">
  import Band from '$lib/components/Band.svelte';
  import Closing from '$lib/components/Closing.svelte';
  import Dua from '$lib/components/Dua.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import Header from '$lib/components/Header.svelte';
  import NextReads from '$lib/components/NextReads.svelte';
  import PartnerForm from '$lib/components/PartnerForm.svelte';
  import Prose from '$lib/components/Prose.svelte';
  import Seo from '$lib/components/Seo.svelte';
  import { abs, breadcrumbs } from '$lib/seo';

  // The partner program (ADR 0043, the owner's decision 2026-10-13): accountants, suppliers and
  // agencies who bring food shops earn 20% of each store's plan for its first 12 months, paid by
  // Pix every month. The team approves each partner in the CRM. Same receipt device as /sobre/.
  const path = '/parceiros/';
  const title = 'Seja parceiro da Venduá';
  const description =
    'Contadores, fornecedores e agências que atendem quem vende comida: indique a Venduá e receba 20% do plano de cada loja, por 12 meses, no Pix.';
  const crumbs = [{ name: 'Início', path: '/' }];
  const schema = [
    breadcrumbs([...crumbs, { name: title, path }]),
    {
      '@type': 'WebPage',
      '@id': abs(path),
      url: abs(path),
      name: title,
      description,
      inLanguage: 'pt-BR',
    },
  ];

  const card = [
    { item: 'Comissão', value: '20% do plano' },
    { item: 'Por quanto tempo', value: '12 meses por loja' },
    { item: 'Pagamento', value: 'Pix, todo mês' },
    { item: 'Custo para você', value: 'nenhum' },
    { item: 'Aprovação', value: 'pela equipe' },
  ];
</script>

<Seo title="Parceiros · Venduá" {description} {path} {schema} />
<Header home={false} overlay />

<main id="conteudo">
  <Band
    {crumbs}
    {title}
    lede="Você atende doceiras, marmitarias e padarias todo mês. Quando uma delas abrir a loja na Venduá pelo seu link, 20% do plano dela volta para você, por um ano."
  >
    {#snippet art()}<Dua pose="carinho" size={300} eager />{/snippet}
  </Band>

  <div class="wrap body">
    <aside class="receipt" aria-labelledby="ficha">
      <h2 id="ficha" class="receipt-title">A parceria numa ficha</h2>
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
        <h2 id="como">Como funciona</h2>
        <ol>
          <li>
            <strong>Você se inscreve aqui embaixo.</strong> A equipe da Venduá confere e te chama no WhatsApp
            com o seu link de parceiro.
          </li>
          <li>
            <strong>Você indica.</strong> Mande o link para os clientes que vendem comida. Quem cria a
            loja por ele fica ligado a você.
          </li>
          <li>
            <strong>A loja paga o plano, você recebe.</strong> De cada mensalidade paga nos 12 primeiros
            meses de cada loja, 20% são seus. A Venduá soma tudo e manda o Pix uma vez por mês.
          </li>
        </ol>

        <h2 id="para-quem">Para quem é</h2>
        <p>
          Para quem já está perto de quem vende comida feita em casa ou em cozinha pequena:
          escritórios de contabilidade, fornecedores de embalagens e insumos, agências e social
          medias, consultores de cardápio. Você não precisa vender nada nem dar suporte: a loja se
          cria pelo celular, com o Duá, e a equipe da Venduá atende quem tiver dúvida.
        </p>

        <h2 id="contas">Quanto dá</h2>
        <p>
          A comissão é sobre o que a loja paga de plano. Uma loja no Venduá Bandeira, de R$ 169 por
          mês, rende R$ 33,80 por mês para você no primeiro ano. Dez lojas, R$ 338 por mês. Mês sem
          pagamento da loja não gera comissão, e os 12 meses contam a partir do dia em que a loja
          foi criada.
        </p>

        <h2 id="inscricao">Inscrição</h2>
      </Prose>
      <PartnerForm />
    </div>
  </div>

  <Closing title="Conhece alguém que vende comida?">
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
  .text {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
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
