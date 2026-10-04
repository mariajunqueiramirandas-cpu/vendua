<script lang="ts" module>
  import type { Kind } from './KindArt.svelte';
  import type { Feature } from '$lib/plans/live.svelte';
  import type { ScreenKey } from '$lib/screens';

  /** the four demos on the home page, opened by `/#demo-<id>` */
  export type DemoId = 'vendedor' | 'pedido' | 'cozinha' | 'loja';

  export type NicheContent = {
    kind: Kind;
    /** <title>, ending in "· Venduá" */
    seoTitle: string;
    description: string;
    title: string;
    lede: string;
    /** how the store works for this kind of shop, one moment per chapter */
    chapters: {
      title: string;
      text: string[];
      screen?: ScreenKey;
      /** what the screen shows, when SCREENS' own description doesn't fit the page */
      alt?: string;
      demo?: { id: DemoId; label: string };
    }[];
    /** what the recommended plan adds, each perk shown only while the CRM gives it that feature */
    extras: { lede: string; perks: { feature: Feature; name: string; text: string }[] };
    questions: { q: string; a: string }[];
    closing: string;
  };
</script>

<script lang="ts">
  import { plans } from '$lib/plans/live.svelte';
  import { nicheFor } from '$lib/pages';
  import { abs, breadcrumbs } from '$lib/seo';
  import Band from './Band.svelte';
  import Closing from './Closing.svelte';
  import Footer from './Footer.svelte';
  import Header from './Header.svelte';
  import KindArt from './KindArt.svelte';
  import NextReads from './NextReads.svelte';
  import Phone from './Phone.svelte';
  import Screen from './Screen.svelte';
  import Seo from './Seo.svelte';

  // A page for one kind of shop (/para/<kind>/): the dawn band, the store's day told for that
  // kitchen next to the real admin screens, what Bandeira adds, the questions that kitchen asks,
  // and the sunset with the call to action. Each page brings only its words (NicheContent).
  let { content: c }: { content: NicheContent } = $props();

  const niche = $derived(nicheFor(c.kind));
  const extra = $derived(plans.bandeira);
  const perks = $derived(c.extras.perks.filter((p) => extra.features[p.feature]));
  const schema = $derived([
    breadcrumbs([
      { name: 'Início', path: '/' },
      { name: c.title, path: niche.path },
    ]),
    {
      '@type': 'WebPage',
      '@id': abs(niche.path),
      url: abs(niche.path),
      name: c.seoTitle,
      description: c.description,
      inLanguage: 'pt-BR',
      about: { '@id': abs('/#app') },
    },
    {
      '@type': 'FAQPage',
      mainEntity: c.questions.map((q) => ({
        '@type': 'Question',
        name: q.q,
        acceptedAnswer: { '@type': 'Answer', text: q.a },
      })),
    },
  ]);
</script>

<Seo title={c.seoTitle} description={c.description} path={niche.path} {schema} />
<Header home={false} overlay />

<main id="conteudo">
  <Band crumbs={[{ name: 'Início', path: '/' }]} title={c.title} lede={c.lede}>
    {#snippet art()}<KindArt kind={c.kind} />{/snippet}
  </Band>

  <div class="wrap day">
    {#each c.chapters as ch, i (ch.title)}
      <section class="chapter" class:flip={i % 2 === 1} aria-labelledby="cap-{i}">
        <div class="copy">
          <h2 id="cap-{i}" class="t-title-1">{ch.title}</h2>
          {#each ch.text as p (p)}<p>{p}</p>{/each}
          {#if ch.demo}
            <p class="demo"><a href="/#demo-{ch.demo.id}">{ch.demo.label}</a></p>
          {/if}
        </div>
        {#if ch.screen}
          <figure class="shot">
            <Phone width={250}>
              <Screen key={ch.screen} alt={ch.alt} sizes="(max-width: 560px) 62vw, 250px" />
            </Phone>
          </figure>
        {/if}
      </section>
    {/each}

    {#if perks.length}
      <aside class="receipt" aria-labelledby="extras-t">
        <h2 id="extras-t" class="t-title-1">No {extra.name}, a loja faz mais</h2>
        <p class="receipt-lede">{c.extras.lede}</p>
        <dl>
          {#each perks as p (p.feature)}
            <div class="line">
              <dt>{p.name}</dt>
              <dd>{p.text}</dd>
            </div>
          {/each}
        </dl>
      </aside>
    {/if}

    <section class="questions" aria-labelledby="perguntas-t">
      <h2 id="perguntas-t" class="t-title-1">Perguntas de quem vende</h2>
      <dl>
        {#each c.questions as q (q.q)}
          <div class="qa">
            <dt>{q.q}</dt>
            <dd>{q.a}</dd>
          </div>
        {/each}
      </dl>
    </section>
  </div>

  <Closing title={c.closing}>
    <NextReads current={niche.path} />
  </Closing>
</main>
<Footer />

<style>
  .day {
    display: grid;
    gap: clamp(56px, 8vw, 104px);
    padding-block: clamp(24px, 4vw, 48px) clamp(64px, 9vw, 112px);
    --body: color-mix(in srgb, var(--ink) 50%, var(--ink-muted));
  }

  /* text and a real screen side by side, the phone switching sides chapter to chapter */
  .chapter {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 28px;
    align-items: center;
  }
  .copy {
    display: grid;
    gap: 14px;
    max-width: 36rem;
  }
  .copy p {
    font-size: 1.0625rem;
    line-height: 1.7;
    color: var(--body);
  }
  .demo a {
    font-weight: 600;
    color: var(--ink);
    text-decoration-color: color-mix(in srgb, var(--spark) 90%, var(--ink));
    text-decoration-thickness: 3px;
    text-underline-offset: 5px;
  }
  .demo a:hover {
    text-decoration-color: var(--ink);
  }
  .shot {
    justify-self: center;
    width: min(250px, 62vw);
  }
  @media (min-width: 860px) {
    .chapter {
      grid-template-columns: minmax(0, 1fr) 250px;
      gap: 72px;
      padding-inline: clamp(0px, 4vw, 56px);
    }
    .chapter.flip {
      grid-template-columns: 250px minmax(0, 1fr);
    }
    .chapter.flip .shot {
      grid-column: 1;
      grid-row: 1;
    }
  }

  /* what the recommended plan adds, as a receipt: the same device as the price block */
  .receipt {
    justify-self: center;
    width: 100%;
    max-width: 44rem;
    padding: clamp(22px, 4vw, 36px);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-e2), var(--highlight);
    rotate: -0.4deg;
  }
  .receipt-lede {
    margin-top: 10px;
    color: var(--body);
  }
  .receipt dl {
    margin-top: 18px;
  }
  .line {
    display: grid;
    gap: 2px;
    padding-block: 14px;
    border-top: 2px dotted var(--line-strong);
  }
  .line dt {
    font: 600 1.0625rem/1.4 var(--font-display);
    color: var(--ink);
  }
  .line dd {
    color: var(--body);
    line-height: 1.55;
  }
  @media (min-width: 640px) {
    .line {
      grid-template-columns: 12rem minmax(0, 1fr);
      gap: 24px;
    }
  }

  .questions {
    display: grid;
    gap: 20px;
    max-width: 44rem;
  }
  .qa {
    display: grid;
    gap: 6px;
    padding-block: 18px;
    border-bottom: 1px solid var(--line);
  }
  .qa:first-child {
    border-top: 1px solid var(--line);
  }
  .qa dt {
    font: 600 1.125rem/1.4 var(--font-display);
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .qa dd {
    color: var(--body);
    line-height: 1.65;
    max-width: 62ch;
  }
</style>
