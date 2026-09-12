<script lang="ts">
  import { site } from '$lib/content/site';
</script>

<section class="closing">
  <div class="container closing-inner">
    <p class="eyebrow">Em desenvolvimento · acesso antecipado</p>
    <h2>A porta é <em class="serif">o direct.</em></h2>
    <p class="closing-text">
      A Venduá ainda está sendo construída — a porta abre no lançamento, primeiro para quem está na
      lista. Diga o que você vende; cada pedido é lido por uma pessoa.
    </p>
    <a class="button" href={site.instagramDmUrl} target="_blank" rel="noreferrer"
      >Pedir acesso <span aria-hidden="true">↗</span><span class="sr-only">(nova aba)</span></a
    >
  </div>
  <div class="marquee" aria-hidden="true">
    <div class="marquee-track">
      {#each [0, 1] as half}<span
          >Em desenvolvimento — Lançamento em breve — Convites pelo direct — Em desenvolvimento —
          Lançamento em breve — Convites pelo direct — Em desenvolvimento — Lançamento em breve —
          Convites pelo direct —
        </span>{/each}
    </div>
  </div>
</section>
