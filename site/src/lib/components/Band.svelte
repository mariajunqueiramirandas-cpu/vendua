<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Crumb } from '$lib/seo';

  // The dawn band that opens every inner page: where the page sits (crumbs, the current page is the
  // h1), the title, the lede, and a drawing on a lit disc. The header floats over it, like on the home.
  let {
    crumbs,
    title,
    lede,
    art,
    children,
  }: {
    crumbs: Crumb[];
    title: string;
    lede: string;
    art: Snippet;
    children?: Snippet;
  } = $props();
</script>

<div class="band">
  <div class="wrap row">
    <div class="intro">
      <nav class="crumbs" aria-label="Onde você está">
        <ol>
          {#each crumbs as c (c.path)}
            <li><a href={c.path}>{c.name}</a></li>
          {/each}
        </ol>
      </nav>
      <h1 class="t-display">{title}</h1>
      <p class="t-lede">{lede}</p>
      {#if children}<div class="more">{@render children()}</div>{/if}
    </div>
    <div class="art" aria-hidden="true">
      <span class="halo"></span>
      {@render art()}
    </div>
  </div>
</div>

<style>
  .band {
    background: linear-gradient(180deg, var(--sky-0) 0%, var(--sky-1) 62%, var(--bg) 100%);
    padding-top: calc(var(--header-h) + env(safe-area-inset-top, 0px));
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding-block: 32px 24px;
  }
  .intro {
    display: grid;
    gap: 16px;
    max-width: 40rem;
  }
  .more {
    margin-top: 8px;
  }

  .crumbs ol {
    display: flex;
    flex-wrap: wrap;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 15px;
    color: var(--ink-muted);
  }
  .crumbs li + li::before {
    content: '/';
    padding-inline: 10px;
    color: var(--line-strong);
  }
  .crumbs a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: color-mix(in srgb, var(--ink) 50%, var(--ink-muted));
    font-weight: 600;
    text-decoration-color: color-mix(in srgb, var(--ink) 30%, transparent);
    text-underline-offset: 4px;
  }
  .crumbs a:hover {
    color: var(--ink);
  }

  .art {
    position: relative;
    justify-self: center;
    display: grid;
    place-items: center;
    width: min(220px, 62vw);
    aspect-ratio: 1;
    color: var(--ink);
  }
  .halo {
    position: absolute;
    inset: 4%;
    border-radius: 50%;
    background: radial-gradient(
      circle closest-side,
      var(--surface) 0 91%,
      color-mix(in srgb, var(--spark) 45%, var(--surface)) 91.5% 99%,
      transparent 100%
    );
    box-shadow: var(--shadow-e1);
  }
  .art > :global(:not(.halo)) {
    position: relative;
    width: 86%;
    animation: stand 1.1s var(--ease-soft) 0.2s both;
  }
  /* Duá stands on the disc's edge; a line drawing sits in the middle of it */
  .art > :global(img) {
    width: 94%;
    translate: 0 -3%;
    filter: drop-shadow(0 10px 14px rgb(18 60 50 / 0.16));
  }
  .art > :global(svg) {
    width: 72%;
  }
  @keyframes stand {
    from {
      transform: translateY(10px) rotate(-3deg);
    }
    to {
      transform: none;
    }
  }

  @media (min-width: 768px) {
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 48px;
      padding-block: 48px 40px;
    }
    .art {
      width: 260px;
    }
  }
  @media (min-width: 1024px) {
    .row {
      padding-block: 72px 48px;
    }
    .art {
      width: 300px;
      margin-right: 40px;
    }
  }

  @media (prefers-color-scheme: dark) {
    /* Duá is forest green: a warm lit disc keeps him readable on the night palette */
    .halo {
      background: radial-gradient(
        circle closest-side,
        var(--after-ink) 0 91%,
        color-mix(in srgb, var(--spark) 40%, var(--after-ink)) 91.5% 99%,
        transparent 100%
      );
      box-shadow: 0 0 60px color-mix(in srgb, var(--spark) 16%, transparent);
    }
    /* on the light disc the drawing keeps day ink */
    .art {
      color: #123c32;
    }
    .art > :global(img) {
      filter: drop-shadow(0 10px 14px rgb(0 0 0 / 0.3));
    }
  }
</style>
