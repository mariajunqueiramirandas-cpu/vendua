<script lang="ts">
  import { site } from '$lib/content/site';
</script>

<footer class="container footer">
  <div>
    <a href="/" class="brand">venduá.</a>
    <p>{site.tagline}</p>
  </div>
  <div class="footer-links">
    <a href={site.instagramUrl}
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
      >Instagram · @vendua.digital ↗</a
    >{#each site.emails as email}<a href="mailto:{email}">{email}</a>{/each}<a href="/contato/"
      >Acesso</a
    ><a href="/privacidade/">Privacidade</a>
  </div>
  <p class="fine">Venduá — em desenvolvimento · vitrines com sistema por trás.</p>
</footer>
