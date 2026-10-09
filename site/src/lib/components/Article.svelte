<script lang="ts">
  import type { Snippet } from 'svelte';
  import { article as find } from '$lib/pages';
  import { article, breadcrumbs } from '$lib/seo';
  import Band from './Band.svelte';
  import Closing from './Closing.svelte';
  import Dua, { type Pose } from './Dua.svelte';
  import Footer from './Footer.svelte';
  import Header from './Header.svelte';
  import NextReads from './NextReads.svelte';
  import Prose from './Prose.svelte';
  import Seo from './Seo.svelte';

  // A guide (/guias/<slug>/) or a news post (/novidades/<slug>/): title and description come from
  // $lib/pages, the page brings the lede, Duá's pose, the outline (the h2 ids) and the text (styled
  // by Prose).
  let {
    path,
    lede,
    pose,
    outline,
    closing,
    children,
  }: {
    path: string;
    lede: string;
    pose: Pose;
    outline: { id: string; title: string }[];
    closing: string;
    children: Snippet;
  } = $props();

  const g = $derived(find(path));
  const news = $derived(path.startsWith('/novidades/'));
  const crumbs = $derived([
    { name: 'Início', path: '/' },
    news ? { name: 'Novidades', path: '/novidades/' } : { name: 'Guias', path: '/guias/' },
  ]);
  const schema = $derived([
    breadcrumbs([...crumbs, { name: g.title, path }]),
    article({ title: g.title, description: g.description, path, published: g.published }),
  ]);
  const date = $derived(
    new Date(`${g.published}T12:00:00Z`).toLocaleDateString('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  );
</script>

<Seo title="{g.title} · Venduá" description={g.description} {path} type="article" {schema} />
<Header home={false} overlay />

<main id="conteudo">
  <Band {crumbs} title={g.title} {lede}>
    {#snippet art()}<Dua {pose} size={300} eager />{/snippet}
    <p class="t-caption byline">
      Equipe Venduá, <time datetime={g.published}>{date}</time>
    </p>
  </Band>

  <div class="wrap body">
    <nav class="outline" aria-labelledby="neste-guia">
      <h2 id="neste-guia" class="outline-title">{news ? 'Neste texto' : 'Neste guia'}</h2>
      <ol>
        {#each outline as o (o.id)}
          <li><a href="#{o.id}">{o.title}</a></li>
        {/each}
      </ol>
    </nav>
    <article class="text">
      <Prose>{@render children()}</Prose>
    </article>
  </div>

  <Closing title={closing}>
    <NextReads current={path} />
  </Closing>
</main>
<Footer />

<style>
  .byline {
    color: var(--ink-muted);
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 32px;
    padding-block: 16px clamp(64px, 9vw, 112px);
  }

  .outline {
    align-self: start;
    max-width: 30rem;
    padding: 18px 20px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }
  .outline-title {
    font: 600 1rem/1.4 var(--font-display);
    margin-bottom: 6px;
  }
  .outline ol {
    display: grid;
    margin: 0;
    padding-left: 1.25em;
    color: var(--ink-muted);
  }
  .outline a {
    display: block;
    padding-block: 7px;
    line-height: 1.4;
    color: var(--ink);
    text-decoration-color: color-mix(in srgb, var(--ink) 30%, transparent);
    text-underline-offset: 4px;
  }
  .outline a:hover {
    text-decoration-color: currentColor;
  }

  @media (min-width: 1024px) {
    .body {
      grid-template-columns: minmax(0, 40rem) 280px;
      justify-content: space-between;
      column-gap: 64px;
      padding-top: 32px;
    }
    .outline {
      grid-column: 2;
      grid-row: 1;
      position: sticky;
      top: calc(var(--header-h) + 24px);
    }
    .text {
      grid-column: 1;
      grid-row: 1;
    }
  }
</style>
