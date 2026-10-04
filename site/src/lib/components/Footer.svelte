<script lang="ts">
  import { site } from '$lib/content';
  import { niches } from '$lib/pages';
  import Logo from './Logo.svelte';

  // Sits on the night sky at the bottom of every page, so it always uses the "after" tone.
  // Every inner page is linked from here: it's how readers and search engines find them.
</script>

<footer class="foot" data-tone="after">
  <div class="wrap row">
    <div class="brand">
      <a class="home" href="/" aria-label="Venduá, início"><Logo tone="after" size={20} /></a>
      <p>Loja online e app de pedidos para doceiras, marmitarias, hamburguerias e padarias.</p>
    </div>
    <nav aria-label="Rodapé">
      <ul>
        {#each niches as n (n.path)}
          <li><a href={n.path}>{n.label}</a></li>
        {/each}
      </ul>
      <ul>
        <li><a href="/guias/">Guias</a></li>
        <li><a href="/sobre/">Sobre a Venduá</a></li>
        <li><a href="/privacidade/">Privacidade</a></li>
        <li>
          <a href={site.instagram.url} rel="noopener" target="_blank"
            >Instagram {site.instagram.handle}</a
          >
        </li>
      </ul>
    </nav>
  </div>
</footer>

<style>
  .foot {
    --ink: var(--after-ink);
    background: var(--sky-6);
    color: var(--after-muted);
    border-top: 1px solid var(--after-line);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .row {
    display: grid;
    gap: 20px 48px;
    padding-block: 32px;
    font-size: 15px;
  }
  .brand {
    display: grid;
    gap: 10px;
    align-content: start;
  }
  .brand p {
    max-width: 34ch;
    line-height: 1.5;
  }
  nav {
    display: grid;
    gap: 4px 48px;
  }
  @media (min-width: 768px) {
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    nav {
      grid-template-columns: auto auto;
    }
  }
  .home {
    justify-self: start;
    text-decoration: none;
    border-radius: 8px;
  }
  ul {
    display: grid;
    align-content: start;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  a {
    color: var(--after-ink);
    text-decoration-color: rgb(217 248 117 / 0.6);
    text-underline-offset: 4px;
  }
  ul a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
</style>
