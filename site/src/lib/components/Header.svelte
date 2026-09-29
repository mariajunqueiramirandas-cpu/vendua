<script lang="ts">
  import Logo from './Logo.svelte';
  import Soon from './Soon.svelte';

  // Sticky bar; transparent over the dawn sky, glass once the page scrolls (the admin's only glass
  // surfaces are its bars — design spec §4.4). Links are in-page anchors on the home page.
  let { home = true, overlay = false }: { home?: boolean; overlay?: boolean } = $props();
  let scrolled = $state(false);

  $effect(() => {
    const on = () => (scrolled = window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  });

  const links = [
    { href: '#pedidos', label: 'Como funciona' },
    { href: '#preco', label: 'Preço' },
    { href: '#perguntas', label: 'Perguntas' },
  ];
</script>

<header class="bar" class:scrolled class:overlay>
  <div class="wrap row">
    <a class="home" href="/" aria-label="Venduá, início"><Logo /></a>
    <nav aria-label="Seções">
      <ul>
        {#each links as l (l.href)}
          <li><a href={home ? l.href : `/${l.href}`}>{l.label}</a></li>
        {/each}
      </ul>
    </nav>
    <Soon size="sm" />
  </div>
</header>

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 50;
    padding-top: env(safe-area-inset-top, 0px);
    transition:
      background var(--duration-smooth) var(--ease-soft),
      box-shadow var(--duration-smooth) var(--ease-soft);
  }
  /* floats over the first section so the dawn sky runs to the top edge */
  .overlay {
    margin-bottom: calc(-1 * var(--header-h) - env(safe-area-inset-top, 0px));
  }
  .scrolled {
    background: var(--glass);
    box-shadow: 0 1px 0 var(--line);
  }
  @supports (backdrop-filter: blur(20px)) {
    .scrolled {
      background: color-mix(in srgb, var(--bg) 80%, transparent);
      backdrop-filter: blur(20px) saturate(1.4);
      -webkit-backdrop-filter: blur(20px) saturate(1.4);
    }
  }
  @media (prefers-reduced-transparency: reduce) {
    .scrolled {
      background: var(--bg);
      backdrop-filter: none;
    }
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: var(--header-h);
  }
  .home {
    text-decoration: none;
    border-radius: 8px;
  }
  nav {
    margin-left: auto;
  }
  ul {
    display: flex;
    gap: 4px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  nav a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 14px;
    border-radius: 999px;
    font: 600 15px/1 var(--font-sans);
    text-decoration: none;
    color: var(--ink);
  }
  nav a:hover {
    background: var(--hover);
  }
  @media (max-width: 860px) {
    nav {
      display: none;
    }
  }
</style>
