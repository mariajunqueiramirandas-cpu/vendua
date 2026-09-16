<script lang="ts">
  import Seo from '$lib/components/Seo.svelte';
  import { site } from '$lib/content/site';
</script>

<Seo
  title="Privacidade nesta versão | Venduá"
  description="Este site não coleta dados, não usa cookies e não tem formulários. O contato acontece no Instagram."
  path="/privacidade/"
  noindex
/>
<article class="container privacy-page">
  <header class="page-opening">
    <p class="eyebrow">Informações desta versão</p>
    <h1>Privacidade.</h1>
    <p class="intro">Nada aqui sai do seu navegador, porque nada é pedido.</p>
  </header>
  <h2>Sem coleta</h2>
  <p>
    Esta versão não tem formulários, cadastro, analytics ou pixels de publicidade. O site não usa
    cookies; o armazenamento local do navegador guarda apenas a preferência de tema (claro ou
    escuro) e a marcação de introdução já vista; nenhum dado sai do dispositivo.
  </p>
  <h2>O contato é no Instagram</h2>
  <p>
    O único canal é o direct do @vendua.digital, aberto pelo link “Iniciar um projeto”. Ao conversar
    por lá, passam a valer as práticas de privacidade do Instagram.
  </p>
  <h2>Em projetos</h2>
  <p>
    Dados compartilhados durante a descoberta e o build de um projeto são usados apenas para
    executar o trabalho contratado. Repositório, infraestrutura e contas ficam no nome do cliente.
  </p>
  <a class="button" href={site.instagramUrl}>Falar no Instagram ↗</a>
</article>
