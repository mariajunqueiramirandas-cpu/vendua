<script lang="ts">
  import Footer from './Footer.svelte';
  import Header from './Header.svelte';
  import Seo from './Seo.svelte';
</script>

<Seo title="Página não encontrada · Venduá" path="/404/" noindex />
<Header home={false} />
<main id="conteudo" class="wrap">
  <h1 class="t-display">Essa página saiu para entrega.</h1>
  <p><a href="/">Voltar para o início</a></p>
</main>
<Footer />
