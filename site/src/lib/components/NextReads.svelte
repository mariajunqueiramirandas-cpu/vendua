<script lang="ts">
  import { guides, niches } from '$lib/pages';
  import KindArt from './KindArt.svelte';

  // Under the closing's stars: the other kinds of shop and the guides, minus the page you're on.
  let { current }: { current: string } = $props();

  const otherNiches = $derived(niches.filter((n) => n.path !== current));
  const otherGuides = $derived(guides.filter((g) => g.path !== current).slice(0, 3));
</script>

<div class="reads">
  <section aria-labelledby="ler-quem">
    <h3 id="ler-quem" class="t-title-2">Para cada cozinha</h3>
    <ul role="list" class="kinds">
      {#each otherNiches as n (n.path)}
        <li>
          <KindArt kind={n.kind} />
          <a href={n.path}>{n.label}</a>
        </li>
      {/each}
    </ul>
  </section>
  <section aria-labelledby="ler-guias">
    <h3 id="ler-guias" class="t-title-2">Guias</h3>
    <ul role="list" class="guides">
      {#each otherGuides as g (g.path)}
        <li><a href={g.path}>{g.title}</a></li>
      {/each}
      <li><a href="/guias/">Todos os guias</a></li>
    </ul>
  </section>
</div>

<style>
  .reads {
    display: grid;
    gap: 40px;
  }
  h3 {
    color: var(--after-ink);
    margin-bottom: 12px;
  }
  ul {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  li a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    line-height: 1.4;
  }
  .kinds :global(svg) {
    flex: none;
    width: 52px;
    height: auto;
    color: var(--after-ink);
  }
  @media (min-width: 900px) {
    .reads {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
      gap: 64px;
    }
  }
</style>
