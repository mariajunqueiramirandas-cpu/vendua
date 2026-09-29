<script lang="ts">
  import Footer from '$lib/components/Footer.svelte';
  import Header from '$lib/components/Header.svelte';
  import Seo from '$lib/components/Seo.svelte';
  import Hero from '$lib/sections/Hero.svelte';
  import Night from '$lib/sections/Night.svelte';
  import Orders from '$lib/sections/Orders.svelte';
  import WhoFor from '$lib/sections/WhoFor.svelte';
  import YourDay from '$lib/sections/YourDay.svelte';
  import YourStore from '$lib/sections/YourStore.svelte';
</script>

<Seo title="Venduá · Sua loja viva na palma da mão" />

<Header overlay />
<main id="conteudo">
  <Hero />
  <WhoFor />
  <Orders />
  <YourStore />
  <YourDay />
  <Night />
</main>
<Footer />
