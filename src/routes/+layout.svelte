<script lang="ts">
  import '$lib/styles.css';
  import Header from '$lib/components/Header.svelte';
  import Footer from '$lib/components/Footer.svelte';
  let { children } = $props();
</script>

<Header />
<main id="conteudo" tabindex="-1">{@render children()}</main>
<Footer />
