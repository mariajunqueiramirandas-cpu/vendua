<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import { CATS, HOWS, NAME, PRODUCTS, URL, type Shop } from './script';

  // The storefront as the customer sees it, drawn small: address, header, cover with the name,
  // categories, product cards and the bag. Each answer fills a part (like the admin's MiniStore).
  let { shop, reduced }: { shop: Shop; reduced: boolean } = $props();

  const items = $derived(PRODUCTS.filter((p) => shop.cats.includes(p.cat)));
  const cats = $derived(CATS.filter((c) => shop.cats.includes(c.id)));
  const badge = $derived(HOWS.find((h) => h.id === shop.how)?.badge ?? null);
  const t = $derived(reduced ? 0 : 280);
</script>

<div class="store loja-acc-{shop.accent ?? 'none'}" class:still={reduced}>
  <div class="bar">
    {#if shop.named}
      <span class="url" in:fade={{ duration: t }}>{URL}</span>
    {:else}
      <span class="url ghost"></span>
    {/if}
  </div>

  <div class="head">
    <span class="logo">{shop.named ? 'B' : ''}</span>
    {#if shop.named}
      <span class="name" in:fade={{ duration: t }}>{NAME}</span>
    {:else}
      <span class="name ghost"></span>
    {/if}
    <span class="bag">sacola</span>
  </div>

  <div class="cover" class:empty={!shop.named}>
    {#if shop.named}
      <p class="title" in:fly={{ y: 6, duration: t }}>{NAME}</p>
    {:else}
      <span class="ghost line"></span>
      <span class="ghost line short"></span>
    {/if}
    {#if badge}
      {#key badge}
        <p class="how" in:fly={{ y: 4, duration: t }}>{badge}</p>
      {/key}
    {/if}
  </div>

  {#if cats.length}
    <div class="cats">
      {#each cats as c, i (c.id)}
        <span
          class="cat"
          class:on={i === 0}
          in:fade={{ duration: t }}
          animate:flip={{ duration: t }}>{c.label}</span
        >
      {/each}
    </div>
  {/if}

  <div class="grid">
    {#if items.length}
      {#each items as p, i (p.name)}
        <div class="card" in:fly={{ y: 8, duration: t }} animate:flip={{ duration: t }}>
          <span class="photo" style="--mix: {16 + (i % 3) * 8}%"></span>
          <span class="pname">{p.name}</span>
          <span class="price">{p.price}</span>
          <span class="add">Adicionar</span>
        </div>
      {/each}
    {:else}
      {#each [0, 1, 2, 3] as i (i)}
        <span class="card placeholder"></span>
      {/each}
    {/if}
  </div>

  <div class="foot"><span class="cta">ver sacola</span></div>
</div>

<style>
  /* the storefront keeps its own accent (the store's colour, from the admin's presets; global so
     the colour chips can show it too); the rest of it follows the page's theme through tokens */
  .store {
    --soft: color-mix(in srgb, var(--acc) 14%, var(--surface));
    position: relative;
    height: 186cqw;
    overflow: hidden;
    background: var(--surface);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: 3.6cqw;
    line-height: 1.3;
  }
  :global(.loja-acc-none) {
    --acc: var(--ink-muted);
    --on-acc: var(--surface);
  }
  :global(.loja-acc-caramelo) {
    --acc: #ac5e10;
    --on-acc: #ffffff;
  }
  :global(.loja-acc-floresta) {
    --acc: #123c32;
    --on-acc: #ffffff;
  }
  :global(.loja-acc-vinho) {
    --acc: #8e2c48;
    --on-acc: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :global(.loja-acc-caramelo) {
      --acc: #f0a65a;
      --on-acc: #1f1306;
    }
    :global(.loja-acc-floresta) {
      --acc: #8fd3b4;
      --on-acc: #0a100d;
    }
    :global(.loja-acc-vinho) {
      --acc: #f19ab3;
      --on-acc: #24080f;
    }
  }
  .store :is(.logo, .cover, .cat.on, .photo, .add, .cta, .how) {
    transition:
      background-color var(--duration-smooth) var(--ease-soft),
      color var(--duration-smooth) var(--ease-soft),
      border-color var(--duration-smooth) var(--ease-soft);
  }
  .still :is(.logo, .cover, .cat.on, .photo, .add, .cta, .how) {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .store :is(.logo, .cover, .cat.on, .photo, .add, .cta, .how) {
      transition: none;
    }
  }

  .ghost {
    display: block;
    border-radius: 999px;
    background: var(--surface-sunken);
  }

  .bar {
    padding: 1cqw 5cqw 2cqw;
  }
  .url {
    display: block;
    min-height: 6.4cqw;
    padding: 1.2cqw 3cqw;
    border-radius: 999px;
    background: var(--surface-sunken);
    color: var(--ink-muted);
    font-size: 3.1cqw;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 2.4cqw;
    padding: 2cqw 5cqw 3cqw;
    border-bottom: 1px solid var(--line);
  }
  .logo {
    flex: none;
    display: grid;
    place-items: center;
    width: 8.6cqw;
    height: 8.6cqw;
    border-radius: 50%;
    background: var(--acc);
    color: var(--on-acc);
    font-weight: 700;
    font-size: 4cqw;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    font-size: 4cqw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name.ghost {
    flex: 0 1 40%;
    height: 3cqw;
  }
  .bag {
    margin-left: auto;
    padding: 0.8cqw 2.6cqw;
    border-radius: 999px;
    background: var(--surface-sunken);
    font-size: 3cqw;
  }

  .cover {
    margin: 3.4cqw 4cqw 0;
    padding: 4.4cqw 4.6cqw;
    min-height: 24cqw;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1.6cqw;
    border-radius: 4cqw;
    background: var(--acc);
    color: var(--on-acc);
  }
  .cover.empty {
    background: var(--surface-sunken);
  }
  .cover .line {
    width: 64%;
    height: 4cqw;
    background: var(--line-strong);
  }
  .cover .line.short {
    width: 40%;
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 7cqw;
    line-height: 1.05;
    letter-spacing: -0.01em;
  }
  .how {
    align-self: flex-start;
    margin: 0;
    padding: 0.8cqw 2.6cqw;
    border-radius: 999px;
    background: color-mix(in srgb, var(--on-acc) 20%, transparent);
    font-size: 3.1cqw;
    font-weight: 600;
  }

  .cats {
    display: flex;
    gap: 1.8cqw;
    padding: 3.4cqw 4cqw 0;
    overflow: hidden;
  }
  .cat {
    flex: none;
    padding: 1cqw 2.8cqw;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    font-size: 3.1cqw;
    white-space: nowrap;
  }
  .cat.on {
    border-color: transparent;
    background: var(--soft);
    font-weight: 600;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2.6cqw;
    padding: 3.4cqw 4cqw 18cqw;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.6cqw;
    min-width: 0;
  }
  .card.placeholder {
    aspect-ratio: 4 / 4.4;
    border: 1px dashed var(--line-strong);
    border-radius: 3cqw;
  }
  .photo {
    aspect-ratio: 16 / 10;
    margin-bottom: 0.8cqw;
    border-radius: 3cqw;
    background: color-mix(in srgb, var(--acc) var(--mix), var(--surface-sunken));
  }
  .pname {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 2.6em;
    font-size: 3.2cqw;
    font-weight: 600;
  }
  .price {
    font-size: 3.2cqw;
    color: var(--ink-muted);
  }
  .add {
    align-self: flex-start;
    margin-top: 0.6cqw;
    padding: 0.8cqw 2.6cqw;
    border: 1px solid var(--acc);
    border-radius: 999px;
    color: var(--acc);
    font-size: 3cqw;
    font-weight: 600;
  }

  .foot {
    position: absolute;
    inset: auto 0 0;
    padding: 6cqw 4cqw 4cqw;
    background: linear-gradient(transparent, var(--surface) 45%);
  }
  .cta {
    display: block;
    padding: 2.4cqw;
    border-radius: 999px;
    background: var(--acc);
    color: var(--on-acc);
    text-align: center;
    font-size: 3.6cqw;
    font-weight: 700;
  }
</style>
