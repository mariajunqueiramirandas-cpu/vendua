<script lang="ts">
  import Footer from '$lib/components/Footer.svelte';
  import Header from '$lib/components/Header.svelte';
  import Seo from '$lib/components/Seo.svelte';
  import Hero from '$lib/sections/Hero.svelte';
  import Demos from '$lib/sections/Demos.svelte';
  import Night from '$lib/sections/Night.svelte';
  import Plans from '$lib/sections/Plans.svelte';
  import WhoFor from '$lib/sections/WhoFor.svelte';
</script>

<Seo title="Venduá · Sua loja viva na palma da mão" />

<Header overlay />
<main id="conteudo">
  <Hero />
  <WhoFor />
  <Demos />
  <Plans />
  <Night />
</main>
<Footer />
