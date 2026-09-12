<script lang="ts">
  import { onMount } from 'svelte';
  import '@fontsource-variable/space-grotesk/wght.css';
  import '@fontsource/instrument-serif/latin-400-italic.css';
  import '$lib/styles.css';
  import Header from '$lib/components/Header.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import IntroVeil from '$lib/components/IntroVeil.svelte';
  let { children } = $props();

  onMount(() => {
    const onScroll = () => {
      document
        .querySelector('.header-bar')
        ?.classList.toggle('scrolled', scrollY > 80);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });
</script>

<IntroVeil />
<Header />
<main id="conteudo" tabindex="-1">{@render children()}</main>
<Footer />
