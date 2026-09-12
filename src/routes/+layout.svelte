<script lang="ts">
  import '@fontsource-variable/space-grotesk/wght.css';
  import '@fontsource/instrument-serif/latin-400-italic.css';
  import '$lib/styles.css';
  import Header from '$lib/components/Header.svelte';
  import Footer from '$lib/components/Footer.svelte';
  let { children } = $props();
</script>

<Header />
<main id="conteudo" tabindex="-1">{@render children()}</main>
<Footer />
