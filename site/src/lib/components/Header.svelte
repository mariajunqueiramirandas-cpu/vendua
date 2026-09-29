<script lang="ts">
  import Logo from './Logo.svelte';
  import Soon from './Soon.svelte';

  // Sticky bar; transparent over the dawn sky, glass once the page scrolls (the admin's only glass
  // surfaces are its bars — design spec §4.4). The glass takes the tone of whatever passes under it:
  // Section and Footer mark dark skies with data-tone="after" (+ data-dark-from where a band of light
  // sky comes first). Links are in-page anchors on the home page.
  let { home = true, overlay = false }: { home?: boolean; overlay?: boolean } = $props();
  let scrolled = $state(false);
  let after = $state(false);
  let bar: HTMLElement;
  let menu: HTMLDetailsElement;

  $effect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      scrolled = window.scrollY > 8;
      const probe = bar.getBoundingClientRect().bottom - 20;
      after = [...document.querySelectorAll<HTMLElement>('[data-tone="after"]')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.top + Number(el.dataset.darkFrom ?? 0) <= probe && r.bottom > probe;
      });
    };
    const on = () => (frame ||= requestAnimationFrame(measure));
    const close = (e: Event) => {
      if (!menu.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.contains(e.target as Node)) {
        menu.open = false;
        if (e instanceof KeyboardEvent) menu.querySelector('summary')?.focus();
      }
    };
    measure();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on, { passive: true });
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  });

  const links = [
    { href: '#pedidos', label: 'Como funciona' },
    { href: '#preco', label: 'Preço' },
    { href: '#perguntas', label: 'Perguntas' },
  ];
  const href = (h: string) => (home ? h : `/${h}`);
</script>

<svelte:head>
  <!-- without JS the bar never learns it scrolled: keep it glass so it never floats bare over text -->
  <noscript>{@html '<style>[data-header]{background:var(--glass)}</style>'}</noscript>
</svelte:head>

<header class="bar" class:scrolled class:after class:overlay data-header bind:this={bar}>
  <div class="wrap row">
    <a class="home" href="/" aria-label="Venduá, início"><Logo tone={after ? 'after' : 'day'} /></a>
    <nav class="full" aria-label="Seções">
      <ul>
        {#each links as l (l.href)}
          <li><a href={href(l.href)}>{l.label}</a></li>
        {/each}
      </ul>
    </nav>
    <details class="menu" bind:this={menu}>
      <summary aria-label="Seções da página"><span class="lines" aria-hidden="true"></span></summary
      >
      <nav aria-label="Seções">
        <ul class="sheet">
          {#each links as l (l.href)}
            <li><a href={href(l.href)} onclick={() => (menu.open = false)}>{l.label}</a></li>
          {/each}
        </ul>
      </nav>
    </details>
    <Soon size="sm" tone={after ? 'after' : 'day'} />
  </div>
</header>

<style>
  .bar {
    --tint: var(--bg);
    position: sticky;
    top: 0;
    z-index: 50;
    padding-top: env(safe-area-inset-top, 0px);
    transition:
      background var(--duration-smooth) var(--ease-soft),
      box-shadow var(--duration-smooth) var(--ease-soft);
  }
  /* over dusk, night and the footer: light ink on a glass tinted by the dusk sky */
  .after {
    --tint: var(--sky-5);
    --ink: var(--after-ink);
    --line: var(--after-line);
    --hover: var(--after-card);
    color: var(--after-ink);
  }
  /* floats over the first section so the dawn sky runs to the top edge */
  .overlay {
    margin-bottom: calc(-1 * var(--header-h) - env(safe-area-inset-top, 0px));
  }
  .scrolled {
    background: color-mix(in srgb, var(--tint) 94%, transparent);
    box-shadow: 0 1px 0 var(--line);
  }
  @supports (backdrop-filter: blur(20px)) {
    .scrolled {
      background: color-mix(in srgb, var(--tint) 84%, transparent);
      backdrop-filter: blur(20px) saturate(1.4);
      -webkit-backdrop-filter: blur(20px) saturate(1.4);
    }
  }
  @media (prefers-reduced-transparency: reduce) {
    .scrolled {
      background: var(--tint);
      backdrop-filter: none;
    }
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: var(--header-h);
  }
  .home {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin-right: auto;
    text-decoration: none;
    border-radius: 8px;
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

  /* below 860 px the three links fold into a disclosure: <details> opens without JS */
  .menu {
    position: relative;
    display: none;
  }
  summary {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    color: var(--ink);
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover,
  .menu[open] summary {
    background: var(--hover);
  }
  .lines {
    position: relative;
    width: 18px;
    height: 12px;
    border-block: 2px solid currentColor;
    border-radius: 1px;
  }
  .lines::after {
    content: '';
    position: absolute;
    inset: 3px 0 auto;
    border-top: 2px solid currentColor;
  }
  .sheet {
    position: absolute;
    top: calc(100% + 10px);
    right: -8px;
    flex-direction: column;
    gap: 2px;
    min-width: 200px;
    padding: 8px;
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    box-shadow: var(--shadow-e3), var(--highlight);
  }
  .after .sheet {
    background: var(--sky-5);
    box-shadow:
      0 0 0 1px var(--after-line),
      0 24px 64px rgb(0 0 0 / 0.4);
  }
  .sheet a {
    display: flex;
    min-height: 48px;
    padding: 0 14px;
    border-radius: var(--radius-sm);
    font-size: 16px;
  }

  @media (max-width: 860px) {
    .full {
      display: none;
    }
    .menu {
      display: block;
    }
  }
</style>
