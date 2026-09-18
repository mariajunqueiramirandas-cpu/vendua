<script lang="ts">
  import { page } from '$app/state';
  import { site } from '$lib/content/site';
</script>

<footer class="container footer">
  <div>
    <a
      href="/"
      class="brand"
      translate="no"
      aria-current={page.url.pathname === '/' ? 'page' : undefined}>venduá.</a
    >
    <p>{site.tagline}</p>
  </div>
  <div class="footer-links">
    <a href={site.instagramUrl} target="_blank" rel="noreferrer"
      ><svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
        ><rect x="2.75" y="2.75" width="18.5" height="18.5" rx="5.5" /><circle
          cx="12"
          cy="12"
          r="4.25"
        /><circle cx="17.4" cy="6.6" r="1.3" fill="currentColor" stroke="none" /></svg
      >Instagram · {site.instagramHandle} <span class="sr-only">(nova aba)</span><span
        aria-hidden="true">↗</span
      ></a
    >
    {#each site.emails as email}
      <a href="mailto:{email}">{email}</a>
    {/each}
    <a href="/contato/" aria-current={page.url.pathname.startsWith('/contato') ? 'page' : undefined}
      >Contato</a
    >
    <a
      href="/privacidade/"
      aria-current={page.url.pathname.startsWith('/privacidade') ? 'page' : undefined}
      >Privacidade</a
    >
  </div>
  <p class="fine">Venduá · software sob medida · plataforma em desenvolvimento.</p>
</footer>
