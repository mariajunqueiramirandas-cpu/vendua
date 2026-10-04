<script lang="ts">
  import { site } from '$lib/content';
  import { graph } from '$lib/seo';

  // `schema` adds what the page is (product, article, breadcrumbs: $lib/seo) to the brand's JSON-LD.
  let {
    title,
    description = site.description,
    path = '/',
    noindex = false,
    type = 'website',
    schema = [],
  }: {
    title: string;
    description?: string;
    path?: string;
    noindex?: boolean;
    type?: 'website' | 'article';
    schema?: object[];
  } = $props();

  const url = $derived(new URL(path, site.domain).href);
  const image = new URL('/og.png', site.domain).href;
  const ld = $derived(graph(schema));
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={url} />
  {#if noindex}<meta name="robots" content="noindex" />{/if}
  <meta property="og:type" content={type} />
  <meta property="og:locale" content="pt_BR" />
  <meta property="og:site_name" content={site.name} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={url} />
  <meta property="og:image" content={image} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta
    property="og:image:alt"
    content="O app da Venduá no celular: Bom dia, Nena. R$ 718,00 em vendas hoje. E o Duá, o tamanduá da Venduá."
  />
  <meta name="twitter:card" content="summary_large_image" />
  {#if !noindex}{@html `<script type="application/ld+json">${ld}</script>`}{/if}
</svelte:head>
