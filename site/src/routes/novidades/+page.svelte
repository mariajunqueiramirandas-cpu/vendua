<script lang="ts">
  import Band from '$lib/components/Band.svelte';
  import Closing from '$lib/components/Closing.svelte';
  import Dua from '$lib/components/Dua.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import Header from '$lib/components/Header.svelte';
  import Seo from '$lib/components/Seo.svelte';
  import { posts } from '$lib/pages';
  import { abs, breadcrumbs } from '$lib/seo';

  const path = '/novidades/';
  const title = 'Novidades da Venduá';
  const description =
    'O que mudou na Venduá e no Duá, o vendedor com IA no WhatsApp da loja: o que cada novidade faz pela sua cozinha e como a gente fez.';
  const crumbs = [{ name: 'Início', path: '/' }];
  const schema = [
    breadcrumbs([...crumbs, { name: 'Novidades', path }]),
    {
      '@type': 'CollectionPage',
      '@id': abs(path),
      url: abs(path),
      name: title,
      description,
      inLanguage: 'pt-BR',
      hasPart: posts.map((p) => ({ '@type': 'Article', headline: p.title, url: abs(p.path) })),
    },
  ];
  const date = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
</script>

<Seo title="{title} · Venduá" {description} {path} {schema} />
<Header home={false} overlay />

<main id="conteudo">
  <Band
    {crumbs}
    {title}
    lede="O que mudou no produto, contado para quem vende: o que cada novidade faz no dia da loja e, quando vale a pena, como a gente fez."
  >
    {#snippet art()}<Dua pose="publicar" size={300} eager />{/snippet}
  </Band>

  <div class="wrap body">
    <ul class="list" role="list">
      {#each posts as p (p.path)}
        <li>
          <time class="t-caption" datetime={p.published}>{date(p.published)}</time>
          <h2 class="t-title-2"><a href={p.path}>{p.title}</a></h2>
          <p>{p.description}</p>
        </li>
      {/each}
    </ul>
  </div>

  <Closing title="Quando quiser, a sua loja fica pronta em cerca de uma hora." />
</main>
<Footer />

<style>
  .body {
    padding-block: 16px clamp(64px, 9vw, 112px);
  }
  .list {
    display: grid;
    max-width: 44rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: grid;
    gap: 8px;
    padding-block: 24px;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  time {
    color: var(--ink-muted);
  }
  .list a {
    text-decoration-color: color-mix(in srgb, var(--ink) 30%, transparent);
    text-decoration-thickness: 2px;
    text-underline-offset: 5px;
  }
  .list a:hover {
    text-decoration-color: currentColor;
  }
  .list p {
    max-width: 60ch;
    line-height: 1.6;
    color: color-mix(in srgb, var(--ink) 50%, var(--ink-muted));
  }
</style>
