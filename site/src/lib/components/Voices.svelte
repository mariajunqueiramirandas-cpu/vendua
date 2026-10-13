<script lang="ts">
  import { testimonials } from '$lib/content';

  // Real owners' words (content.ts), on the night band before the questions. Nothing renders while
  // the list is empty: the site never shows a placeholder or an invented quote.
</script>

{#if testimonials.length}
  <section class="voices" aria-labelledby="vozes">
    <h3 id="vozes" class="t-title-1">Quem já vende pela Venduá</h3>
    <ul role="list">
      {#each testimonials as t (t.quote)}
        <li>
          <blockquote>
            <p>{t.quote}</p>
          </blockquote>
          <p class="who">
            {t.who},
            {#if t.url}<a href={t.url} rel="noopener">{t.store}</a>{:else}{t.store}{/if}
          </p>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .voices {
    display: grid;
    gap: 20px;
    margin-block: clamp(40px, 6vw, 72px);
    color: var(--after-ink);
  }
  ul {
    display: grid;
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  @media (min-width: 900px) {
    ul {
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
  }
  li {
    display: grid;
    align-content: space-between;
    gap: 14px;
    padding: 20px;
    border-radius: var(--radius-lg, 16px);
    background: var(--after-card);
    box-shadow: inset 0 0 0 1px var(--after-line);
  }
  blockquote {
    margin: 0;
  }
  blockquote p {
    font-size: 1.0625rem;
    line-height: 1.6;
  }
  .who {
    font-size: 14px;
    color: var(--after-muted);
  }
  .who a {
    color: var(--after-ink);
    text-underline-offset: 3px;
  }
</style>
