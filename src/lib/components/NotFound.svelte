<script lang="ts">
  import Seo from './Seo.svelte';
  import { site } from '$lib/content/site';
</script>

<Seo
  title={`Página não encontrada | ${site.brandName}`}
  description="Duas saídas daqui: voltar ao início ou pedir acesso pelo direct."
  noindex
/>
<section class="container error-page">
  <p class="eyebrow">404 · Caminho não encontrado</p>
  <h1>Esta porta não abre.</h1>
  <p class="intro">Volte ao início ou peça acesso pelo direct. Essa entrada funciona.</p>
  <div class="actions">
    <a class="button" href="/">Voltar ao início</a><a class="button outline" href="/contato/"
      >Pedir acesso</a
    >
  </div>
</section>
