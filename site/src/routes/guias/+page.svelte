<script lang="ts">
  import Band from '$lib/components/Band.svelte';
  import Closing from '$lib/components/Closing.svelte';
  import Dua from '$lib/components/Dua.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import Header from '$lib/components/Header.svelte';
  import KindArt from '$lib/components/KindArt.svelte';
  import Seo from '$lib/components/Seo.svelte';
  import { guides, niches } from '$lib/pages';
  import { abs, breadcrumbs } from '$lib/seo';

  const path = '/guias/';
  const title = 'Guias para vender comida pela internet';
  const description =
    'Guias práticos da Venduá para doceiras, marmitarias, hamburguerias e padarias: vender pelo WhatsApp, montar o cardápio digital, organizar encomendas e ter o próprio delivery.';
  const crumbs = [{ name: 'Início', path: '/' }];
  const schema = [
    breadcrumbs([...crumbs, { name: 'Guias', path }]),
    {
      '@type': 'CollectionPage',
      '@id': abs(path),
      url: abs(path),
      name: title,
      description,
      inLanguage: 'pt-BR',
      hasPart: guides.map((g) => ({ '@type': 'Article', headline: g.title, url: abs(g.path) })),
    },
  ];
</script>

<Seo title="{title} · Venduá" {description} {path} {schema} />
<Header home={false} overlay />

<main id="conteudo">
  <Band
    {crumbs}
    {title}
    lede="O que a gente aprendeu sobre pedido, cardápio, Pix e entrega, escrito para quem está com a mão na massa. Serve com ou sem a Venduá."
  >
    {#snippet art()}<Dua pose="catalogo" size={300} eager />{/snippet}
  </Band>

  <div class="wrap body">
    <ul class="list" role="list">
      {#each guides as g (g.path)}
        <li>
          <h2 class="t-title-2"><a href={g.path}>{g.title}</a></h2>
          <p>{g.description}</p>
        </li>
      {/each}
    </ul>

    <section class="kinds" aria-labelledby="por-negocio">
      <h2 id="por-negocio" class="t-title-1">Para cada cozinha</h2>
      <ul role="list">
        {#each niches as n (n.path)}
          <li>
            <KindArt kind={n.kind} />
            <a href={n.path}>{n.label}</a>
          </li>
        {/each}
      </ul>
    </section>
  </div>

  <Closing title="Quando quiser, a sua loja fica pronta em cerca de uma hora." />
</main>
<Footer />

<style>
  .body {
    display: grid;
    gap: clamp(48px, 7vw, 80px);
    padding-block: 16px clamp(64px, 9vw, 112px);
  }
  .list {
    display: grid;
    max-width: 44rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: grid;
    gap: 8px;
    padding-block: 24px;
    border-bottom: 1px solid var(--line);
  }
  .list li:first-child {
    border-top: 1px solid var(--line);
  }
  .list a {
    text-decoration-color: color-mix(in srgb, var(--ink) 30%, transparent);
    text-decoration-thickness: 2px;
    text-underline-offset: 5px;
  }
  .list a:hover {
    text-decoration-color: currentColor;
  }
  .list p {
    max-width: 60ch;
    line-height: 1.6;
    color: color-mix(in srgb, var(--ink) 50%, var(--ink-muted));
  }

  .kinds ul {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 40px;
    margin: 20px 0 0;
    padding: 0;
    list-style: none;
  }
  .kinds li {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .kinds :global(svg) {
    width: 64px;
    height: auto;
  }
  .kinds a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-weight: 600;
    text-underline-offset: 4px;
  }
</style>
