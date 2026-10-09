<script lang="ts">
  // The sign-up's confirmation page on this domain, for Google Ads: the admin sends a new store here
  // when its sign-up ends (apps/admin signup `finish`), GA4 gets `sign_up` and the page view, and the
  // owner goes straight on to the admin's first steps. Nothing links here; noindex keeps it out of
  // the sitemap.
  import { onMount } from 'svelte';
  import Dua from '$lib/components/Dua.svelte';
  import Seo from '$lib/components/Seo.svelte';
  import { welcomeUrl } from '$lib/content';
  import { sendSignUp } from '$lib/gtag';

  onMount(() => sendSignUp(() => location.replace(welcomeUrl)));
</script>

<svelte:head>
  <noscript><meta http-equiv="refresh" content="0; url={welcomeUrl}" /></noscript>
</svelte:head>

<Seo title="Loja criada · Venduá" path="/loja-criada/" noindex />

<main id="conteudo" class="done">
  <div class="card">
    <span class="disc" aria-hidden="true">
      <Dua pose="sucesso" size={180} eager class="done-dua" />
    </span>
    <h1 class="t-display">Loja criada!</h1>
    <p class="t-lede">Levando você para o painel…</p>
    <a class="go" href={welcomeUrl}>Abrir o painel</a>
  </div>
</main>

<style>
  .done {
    display: grid;
    place-items: center;
    min-height: 100svh;
    padding: 24px 16px;
    background: linear-gradient(180deg, var(--sky-0) 0%, var(--sky-1) 100%);
  }
  .card {
    display: grid;
    justify-items: center;
    gap: 12px;
    text-align: center;
  }
  .disc {
    display: grid;
    place-items: center;
    width: 160px;
    aspect-ratio: 1;
    margin-bottom: 8px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow-e1);
  }
  .disc :global(.done-dua) {
    width: 88%;
    filter: drop-shadow(0 10px 14px rgb(18 60 50 / 0.16));
  }
  .t-lede {
    color: var(--ink-muted);
  }
  .go {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-weight: 600;
    text-underline-offset: 4px;
    text-decoration-thickness: 1.5px;
    text-decoration-color: color-mix(in srgb, var(--ink) 40%, transparent);
  }

  @media (prefers-color-scheme: dark) {
    /* a lit disc so the forest-green Duá reads on the night palette */
    .disc {
      background: var(--after-ink);
    }
  }
</style>
