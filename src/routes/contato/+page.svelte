<script lang="ts">
  import Seo from '$lib/components/Seo.svelte';
  import BriefBuilder from '$lib/components/BriefBuilder.svelte';
</script>

<Seo
  title="Vamos conversar sobre seu negócio | Venduá"
  description="Conte o que você vende e como recebe pedidos. Prepare uma mensagem para conversar com a Venduá pelo Instagram."
  path="/contato/"
/>
<div class="contact-page container">
  <header class="page-opening">
    <p class="eyebrow">Um primeiro passo, sem complicar</p>
    <h1>Conta um pouco do seu negócio.</h1>
    <p class="intro">
      Prepare uma mensagem rápida para começarmos a conversa pelo Instagram. Você poderá revisar
      tudo antes de enviar.
    </p>
  </header>
  <BriefBuilder />
</div>
