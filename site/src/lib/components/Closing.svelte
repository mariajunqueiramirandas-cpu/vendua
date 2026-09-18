<script lang="ts">
  import { site } from '$lib/content/site';
</script>

<section class="closing" aria-labelledby="closing-title">
  <div class="container closing-inner">
    <p class="eyebrow">Venduá · Software sob medida</p>
    <h2 id="closing-title">Todo projeto começa <span class="serif">numa conversa.</span></h2>
    <p class="closing-text">
      Conte o que precisa existir. Escopo, arquitetura e prazo em resposta.
    </p>
    <a class="button" href={site.instagramDmUrl} target="_blank" rel="noreferrer"
      >Iniciar um projeto <span aria-hidden="true">↗</span><span class="sr-only">(nova aba)</span
      ></a
    >
  </div>
  <div class="marquee" aria-hidden="true">
    <div class="marquee-track">
      {#each [0, 1] as _}
        <span
          >Software sob medida · Plataforma em desenvolvimento · Projetos pelo direct · Software sob
          medida · Plataforma em desenvolvimento · Projetos pelo direct · Software sob medida ·
          Plataforma em desenvolvimento · Projetos pelo direct ·
        </span>
      {/each}
    </div>
  </div>
</section>
