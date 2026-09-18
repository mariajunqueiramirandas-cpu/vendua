<script lang="ts">
  import { page } from '$app/state';
  import Seo from '$lib/components/Seo.svelte';
  import NotFound from '$lib/components/NotFound.svelte';
  import { site } from '$lib/content/site';
</script>

{#if page.status === 404}<NotFound />{:else}<Seo
    title={`Erro ${page.status} | ${site.brandName}`}
    description="Algo falhou deste lado. Tente de novo ou volte ao início."
    noindex
  />
  <section class="container error-page">
    <p class="eyebrow">Erro {page.status}</p>
    <h1>Algo falhou deste lado.</h1>
    <p class="intro">Tente de novo. Se continuar, volte ao início e entre pelo direct.</p>
    <div class="actions">
      <a href="/" class="button">Voltar ao início</a>
    </div>
  </section>{/if}
