<script lang="ts">
  import Seo from '$lib/components/Seo.svelte';
  import ProjectSwitch from '$lib/components/ProjectSwitch.svelte';
  import Closing from '$lib/components/Closing.svelte';
  import { solutions, process, faqs } from '$lib/content/site';
</script>

<Seo
  title="Venduá | Lojas online personalizadas e automação"
  description="Lojas online com a identidade do seu negócio e automações para conectar atendimento, pedidos e operação. Conheça a Venduá."
/>
<section class="hero container">
  <div class="hero-copy">
    <p class="eyebrow"><span class="little-dot"></span> Sites personalizados + automação</p>
    <h1>Bonito para quem compra.<br /><span>Prático para quem vende.</span></h1>
    <p class="intro">
      Uma loja online com a identidade do seu negócio, conectada ao atendimento e à organização dos
      pedidos.
    </p>
    <div class="actions">
      <a class="button" href="/contato/"
        >Conversar sobre meu negócio <span aria-hidden="true">↗</span></a
      ><a class="text-link" href="#projeto">Conhecer o projeto <span aria-hidden="true">↓</span></a>
    </div>
    <p class="fine hero-support">Começando por lojas, confeitarias e delivery.</p>
  </div>
  <div class="hero-art">
    <img
      src="/assets/images/hero-ribbon-960.webp"
      srcset="/assets/images/hero-ribbon-640.webp 640w, /assets/images/hero-ribbon-960.webp 960w, /assets/images/hero-ribbon-1440.webp 1440w"
      sizes="(max-width: 960px) 90vw, 45vw"
      width="1440"
      height="960"
      alt=""
      fetchpriority="high"
    />
    <div class="art-label" aria-hidden="true">
      <span>Vitrine</span><span>Atendimento</span><span>Gestão</span>
    </div>
  </div>
</section>
<section class="journey container" aria-labelledby="journey-title">
  <p class="eyebrow" id="journey-title">Da primeira escolha à organização do pedido.</p>
  <div class="journey-grid">
    {#each [['Escolher', 'Uma vitrine clara para conhecer seus produtos.'], ['Atender', 'Informações da loja para apoiar a conversa.'], ['Organizar', 'Pedidos conectados à rotina de quem prepara.']] as item, i}<div
        class="journey-item"
      >
        <span class="journey-number">0{i + 1}</span>
        <div>
          <h2>{item[0]}</h2>
          <p>{item[1]}</p>
        </div>
      </div>{/each}
  </div>
</section>
<section class="section project-section" id="projeto">
  <div class="container">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Feito para uma rotina de verdade</p>
        <h2>Dois lados da<br />mesma loja.</h2>
      </div>
      <p>
        No Quero Pudim Gourmet, a experiência de quem compra encontra a organização de quem faz os
        doces.
      </p>
    </div>
    <ProjectSwitch /><a class="text-link case-link" href="/projetos/quero-pudim-gourmet/"
      >Conheça o Quero Pudim Gourmet <span aria-hidden="true">↗</span></a
    >
  </div>
</section>
<section class="section container" id="solucoes">
  <p class="eyebrow">Personalizado para fazer sentido</p>
  <h2>O que faz sentido<br />para o seu negócio?</h2>
  <div class="solutions">
    {#each solutions as solution, i}<article class="solution-row">
        <span class="fine">0{i + 1}</span>
        <h3>
          <img
            src={'/assets/icons/' + solution.icon + '.svg'}
            alt=""
            width="28"
            height="28"
          />{solution.title}
        </h3>
        <p>{solution.description}</p>
      </article>{/each}
  </div>
  <p class="fine">Funcionalidades e integrações são definidas na proposta de cada projeto.</p>
</section>
<section class="process-section section" id="processo">
  <div class="container">
    <p class="eyebrow">Como funciona</p>
    <h2>Primeiro, entendemos sua rotina.</h2>
    <ol class="process-grid">
      {#each process as item, i}<li>
          <span class="step-number">0{i + 1}</span>
          <h3>{item[0]}</h3>
          <p>{item[1]}</p>
        </li>{/each}
    </ol>
  </div>
</section>
<section class="section container faq-section">
  <div>
    <p class="eyebrow">Sem complicar</p>
    <h2>Antes da<br />conversa.</h2>
  </div>
  <div class="faq-list">
    {#each faqs as faq}<details>
        <summary>{faq[0]}<span class="faq-plus" aria-hidden="true">+</span></summary>
        <p>{faq[1]}</p>
      </details>{/each}
  </div>
</section>
<Closing />
