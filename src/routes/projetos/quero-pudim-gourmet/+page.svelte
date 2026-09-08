<script lang="ts">
  import Seo from '$lib/components/Seo.svelte';
  import ImageViewer from '$lib/components/ImageViewer.svelte';
  import { project } from '$lib/content/project';
</script>

<Seo
  title="Quero Pudim Gourmet: loja online e gestão | Venduá"
  description="Conheça o projeto do Quero Pudim Gourmet: identidade própria, experiência de compra e recursos para organizar a rotina da loja."
  path="/projetos/quero-pudim-gourmet/"
/>
<article class="container case-page">
  <header class="page-opening">
    <a href="/#projeto" class="text-link">← Todos os projetos</a>
    <p class="eyebrow">Projeto / Loja online e operação</p>
    <h1>Quero Pudim Gourmet: da vitrine à cozinha.</h1>
    <p class="intro">{project.summary}</p>
  </header>
  <section class="case-text">
    <h2>O projeto começou perto.</h2>
    <p>{project.context}</p>
  </section>
  <ImageViewer view={project.views[0]} />
  <section class="case-text">
    <h2>Uma vitrine com o cuidado da marca.</h2>
    <p>
      O site apresenta a identidade do Quero Pudim Gourmet e conduz o cliente pelo catálogo e pela
      compra. A experiência considera os produtos e as opções oferecidas pela loja.
    </p>
  </section>
  <section class="case-callout">
    <div>
      <p class="eyebrow">Da escolha ao preparo</p>
      <h2>Cada tipo de pedido tem sua rotina.</h2>
      <p>
        Pronta-entrega e encomendas pedem regras diferentes. O projeto contempla disponibilidade,
        antecedência e organização dos pedidos para apoiar a operação.
      </p>
    </div>
    <img
      src="/assets/images/operation-bridge-640.webp"
      srcset="/assets/images/operation-bridge-640.webp 640w, /assets/images/operation-bridge-960.webp 960w, /assets/images/operation-bridge-1440.webp 1440w"
      sizes="(max-width: 768px) 90vw, 40vw"
      width="1440"
      height="960"
      alt=""
      loading="lazy"
    />
  </section>
  <section class="case-text">
    <h2>O trabalho continua depois da compra.</h2>
    <p>
      Atendimento no WhatsApp e ferramentas de gestão complementam a loja online. O painel reúne
      pedidos, estoque e atalhos da rotina de produção.
    </p>
  </section>
  <ImageViewer view={project.views[1]} />
  <ul class="capabilities">
    {#each project.capabilities as capability}<li>✓ {capability}</li>{/each}
  </ul>
  <section class="case-end">
    <p>
      Este é o primeiro projeto do nosso portfólio. As funcionalidades de cada nova implantação são
      definidas conforme o negócio.
    </p>
    <a class="button" href="/contato/"
      >Quero conversar sobre algo assim <span aria-hidden="true">↗</span></a
    >
  </section>
</article>
