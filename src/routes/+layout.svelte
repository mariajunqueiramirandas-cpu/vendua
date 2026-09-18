<script lang="ts">
  import { onMount } from 'svelte';
  import '@fontsource-variable/space-grotesk/wght.css';
  import '@fontsource/instrument-serif/latin-400-italic.css';
  import '$lib/styles.css';
  import Header from '$lib/components/Header.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import IntroVeil from '$lib/components/IntroVeil.svelte';
  let { children } = $props();

  let headerBar: Element | null = null;
  const onScroll = () => {
    headerBar?.classList.toggle('scrolled', scrollY > 80);
  };

  onMount(() => {
    headerBar = document.querySelector('.header-bar');
    onScroll();
  });
</script>

<svelte:window onscroll={onScroll} />

<IntroVeil />
<Header />
<main id="conteudo" tabindex="-1">{@render children()}</main>
<Footer />
