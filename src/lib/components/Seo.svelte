<script lang="ts">
  import { site } from '$lib/content/site';
  let {
    title,
    description,
    path = '/',
    noindex = false,
  }: { title: string; description: string; path?: string; noindex?: boolean } = $props();
</script>

<svelte:head>
  <title>{title}</title><meta name="description" content={description} />
  <meta property="og:title" content={title} /><meta
    property="og:description"
    content={description}
  />
  <meta property="og:type" content="website" /><meta property="og:locale" content="pt_BR" /><meta
    property="og:site_name"
    content="Venduá"
  />
  {#if noindex}<meta name="robots" content="noindex, follow" />{/if}
  {#if site.publicDomain}<link rel="canonical" href={new URL(path, site.publicDomain).href} /><meta
      property="og:url"
      content={new URL(path, site.publicDomain).href}
    /><meta
      property="og:image"
      content={new URL('/assets/images/social-card.png', site.publicDomain).href}
    />{/if}
</svelte:head>
