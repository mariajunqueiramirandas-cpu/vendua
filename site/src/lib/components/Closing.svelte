<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { loadLivePlans, plans } from '$lib/plans/live.svelte';
  import Section from './Section.svelte';
  import Start from './Start.svelte';

  // How every inner page ends, like the home: the sun sets, the one call to action, the plans in one
  // line (live from the CRM, like the home's), then what to read next under the stars.
  let { title, children }: { title: string; children?: Snippet } = $props();

  const { mirim, bandeira, pangolim } = plans;
  onMount(() => void loadLivePlans());
</script>

<div class="fade" aria-hidden="true"></div>
<Section tone="after" sky="var(--sunset-night)" labelledby="fim-t" class="closing">
  <div class="dusk" aria-hidden="true">
    <span class="sun"></span>
    <span class="horizon"></span>
  </div>

  <div class="close">
    <h2 id="fim-t" class="t-display moment">{title}</h2>
    <div class="cta">
      <Start tone="after" />
      <p class="plans tnum">
        {bandeira.short} por {bandeira.price}/mês{bandeira.trial ? `, com ${bandeira.trial}` : ''}.
        Também tem o {mirim.short}, por {mirim.price}/mês{#if pangolim.available}, e o {pangolim.short},
          por {pangolim.price}/mês{/if}.
        <a href="/#preco">Compare os planos</a>
      </p>
    </div>
  </div>

  {#if children}<div class="next">{@render children()}</div>{/if}
</Section>

<style>
  /* the page's floor warms into the late-afternoon sky the sunset starts from */
  .fade {
    height: 72px;
    background: linear-gradient(180deg, var(--bg), var(--sky-4));
  }

  .dusk {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }
  .sun {
    --d: clamp(120px, 16vw, 180px);
    position: absolute;
    top: calc(200px - var(--d) / 2);
    right: 10%;
    width: var(--d);
    height: calc(var(--d) / 2);
    border-radius: var(--d) var(--d) 0 0;
    background: linear-gradient(180deg, #fbe1b0 0%, #f2b98c 55%, #d99282 100%);
    box-shadow: 0 0 80px 24px rgb(251 214 160 / 0.35);
    opacity: 0.95;
  }
  .horizon {
    position: absolute;
    top: 200px;
    left: 50%;
    width: 100vw;
    height: 1.5px;
    transform: translateX(-50%);
    background: linear-gradient(
      90deg,
      transparent,
      rgb(247 244 234 / 0.35) 20%,
      rgb(247 244 234 / 0.35) 80%,
      transparent
    );
  }
  @media (prefers-color-scheme: dark) {
    .sun {
      background: linear-gradient(180deg, #7d5a4a 0%, #5a3f3d 100%);
      box-shadow: 0 0 60px 12px rgb(160 110 80 / 0.18);
      opacity: 0.8;
    }
  }

  /* text starts below the band, where the sky is always dark */
  .close {
    display: grid;
    justify-items: center;
    text-align: center;
    padding-top: calc(300px - clamp(64px, 9vw, 128px));
  }
  .moment {
    max-width: 18ch;
    color: var(--after-ink);
  }
  .cta {
    display: grid;
    justify-items: center;
    gap: 14px;
    margin-top: 32px;
  }
  .plans {
    max-width: 40ch;
    font-size: 15px;
    color: var(--after-ink);
  }
  .plans a,
  .next :global(a) {
    color: var(--after-ink);
    font-weight: 600;
    text-decoration-color: color-mix(in srgb, var(--spark) 70%, transparent);
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
  }
  .plans a:hover,
  .next :global(a:hover) {
    text-decoration-color: var(--spark);
  }

  .next {
    margin-top: clamp(56px, 7vw, 88px);
    padding-top: 32px;
    border-top: 1px solid var(--after-line);
    color: var(--after-muted);
  }
</style>
