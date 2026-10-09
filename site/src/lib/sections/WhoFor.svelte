<script lang="ts">
  import KindArt, { type Kind } from '$lib/components/KindArt.svelte';
  import Section from '$lib/components/Section.svelte';
  import { nicheFor } from '$lib/pages';

  const kinds: { art: Kind; name: string; how: string }[] = [
    {
      art: 'bolo',
      name: 'Doces e bolos',
      how: 'Encomenda com data marcada, direto no seu calendário.',
    },
    {
      art: 'marmita',
      name: 'Marmitas',
      how: 'O cardápio muda sozinho do almoço para a janta.',
    },
    {
      art: 'burger',
      name: 'Hambúrgueres',
      how: 'Adicionais e combos: o pedido chega montado.',
    },
    {
      art: 'pao',
      name: 'Pães e fornadas',
      how: 'Acabou a fornada? O cliente entra na lista de espera.',
    },
  ];
</script>

<Section
  id="para-quem"
  tone="day"
  sky="linear-gradient(180deg, var(--sky-1), var(--sky-2))"
  labelledby="para-quem-t"
>
  <header class="head">
    <h2 id="para-quem-t" class="t-display">Feito pra quem faz.</h2>
    <p class="t-lede lede">
      Bolo, marmita, hambúrguer, pão. Cada negócio vende de um jeito, e a sua loja acompanha o seu.
    </p>
  </header>

  <ul class="tiles" role="list">
    {#each kinds as k (k.art)}
      <li class="tile">
        <KindArt kind={k.art} />
        <h3 class="t-title-2"><a href={nicheFor(k.art).path}>{k.name}</a></h3>
        <p class="how">{k.how}</p>
      </li>
    {/each}
  </ul>
</Section>

<style>
  .head {
    display: grid;
    gap: 16px;
    max-width: 40rem;
  }

  .head,
  .tiles {
    /* body copy at 7:1 on the morning sky; plain --ink-muted sits near 5.8:1 */
    --body: color-mix(in srgb, var(--ink) 50%, var(--ink-muted));
  }
  .lede {
    color: var(--body);
  }

  /* two by two on phones, one row of four on wide screens: a glance, not a chapter */
  .tiles {
    list-style: none;
    margin: clamp(28px, 4vw, 48px) 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 28px 16px;
  }
  .tile {
    display: grid;
    align-content: start;
    row-gap: 6px;
    color: var(--ink);
  }
  .tile :global(svg) {
    width: 76px;
    height: auto;
    margin-bottom: 2px;
  }
  /* each kind has its own page: the name is the link */
  .tile a {
    text-decoration-line: underline;
    text-decoration-color: color-mix(in srgb, var(--ink) 28%, transparent);
    text-decoration-thickness: 2px;
    text-underline-offset: 5px;
    border-radius: 4px;
  }
  .tile a:hover {
    text-decoration-color: currentColor;
  }
  .how {
    color: var(--body);
    font-size: 0.9375rem;
    line-height: 1.5;
    max-width: 28ch;
  }
  @media (min-width: 900px) {
    .tiles {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 40px;
    }
    .tile :global(svg) {
      width: 120px;
    }
    .how {
      font-size: 1rem;
    }
  }
</style>
