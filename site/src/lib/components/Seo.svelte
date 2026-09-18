<script lang="ts">
  import { site } from '$lib/content/site';
  let {
    title,
    description,
    path = '/',
    noindex = false,
  }: { title: string; description: string; path?: string; noindex?: boolean } = $props();

  const publicUrl = (p: string) => new URL(p, site.publicDomain).href;
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="pt_BR" />
  <meta property="og:site_name" content={site.brandName} />
  {#if noindex}
    <meta name="robots" content="noindex, follow" />
  {/if}
  {#if site.publicDomain}
    <link rel="canonical" href={publicUrl(path)} />
    <meta property="og:url" content={publicUrl(path)} />
    <meta property="og:image" content={publicUrl('/assets/images/social-card.png')} />
  {/if}
</svelte:head>
