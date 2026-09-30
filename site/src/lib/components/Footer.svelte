<script lang="ts">
  import { site } from '$lib/content';
  import Logo from './Logo.svelte';

  // Sits on the night sky at the bottom of every page, so it always uses the "after" tone.
</script>

<footer class="foot" data-tone="after">
  <div class="wrap row">
    <a class="home" href="/" aria-label="Venduá, início"><Logo tone="after" size={20} /></a>
    <ul>
      <li>
        <a href={site.instagram.url} rel="noopener" target="_blank"
          >Instagram {site.instagram.handle}</a
        >
      </li>
      <li><a href="/privacidade/">Privacidade</a></li>
    </ul>
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
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px 32px;
    padding-block: 28px;
    font-size: 15px;
  }
  .home {
    text-decoration: none;
    border-radius: 8px;
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 24px;
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
