<script lang="ts">
  import Seo from '$lib/components/Seo.svelte';
  import { site } from '$lib/content/site';
</script>

<Seo
  title="Privacidade nesta versão | Venduá"
  description="Como funciona o briefing local e o contato pelo Instagram nesta versão do site Venduá."
  path="/privacidade/"
  noindex
/>
<article class="container privacy-page">
  <header class="page-opening">
    <p class="eyebrow">Informações desta versão</p>
    <h1>Privacidade.</h1>
    <p class="intro">Entenda o que acontece quando você prepara uma mensagem por aqui.</p>
  </header>
  <h2>O briefing fica na página</h2>
  <p>
    As respostas e a mensagem editada ficam na memória da página, sem envio automático à Venduá. Ao
    atualizar ou sair da página, elas são apagadas. O site não guarda essas respostas em cookies ou
    no armazenamento local do navegador.
  </p>
  <h2>Copiar e conversar</h2>
  <p>
    Ao escolher “Copiar mensagem”, o texto vai para a área de transferência do seu dispositivo. O
    link “Abrir Instagram” abre somente o perfil @vendua.digital, sem incluir suas respostas no
    endereço. Você decide se quer colar e enviar a mensagem. No Instagram, passam a valer as
    práticas de privacidade desse serviço.
  </p>
  <h2>Sobre esta versão</h2>
  <p>
    Esta implementação não inclui analytics, pixels de publicidade, cadastro ou formulário com envio
    ao servidor.
  </p>
  <p>
    A política final ainda depende da identificação do responsável e da definição da hospedagem,
    incluindo seus logs, provedores e prazos de retenção. Estas informações descrevem a versão atual
    e não substituem a política final de lançamento.
  </p>
  <a class="button" href={site.instagramUrl}>Conversar sobre privacidade ↗</a>
</article>
