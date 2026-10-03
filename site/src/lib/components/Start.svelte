<script lang="ts">
  import type { Snippet } from 'svelte';
  import { recommended, signup, type PlanId } from '$lib/content';

  // The one call to action: a plain link to sign-up in the merchant admin, so it works without JS.
  // It preselects the recommended plan; the price block links each plan on its own.
  // `short` drops "minha" on the narrowest bars. `children` is the note beside it when it needs markup.
  let {
    size = 'lg',
    tone = 'day',
    plano = recommended.id,
    label = 'Criar minha loja',
    short = false,
    note,
    children,
  }: {
    size?: 'sm' | 'lg';
    tone?: 'day' | 'after';
    plano?: PlanId;
    label?: string;
    short?: boolean;
    note?: string;
    children?: Snippet;
  } = $props();
</script>

<p class="start {size} {tone}">
  <a class="pill" href={signup(plano)}
    >{#if short}<span>Criar <span class="minha">minha</span> loja</span>{:else}{label}{/if}<i
      class="go"
      aria-hidden="true"
    ></i></a
  >
  {#if children}<span class="note">{@render children()}</span>
  {:else if note}<span class="note">{note}</span>{/if}
</p>

<style>
  .start {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    margin: 0;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    border-radius: var(--radius-md);
    font-weight: 600;
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: var(--shadow-e1);
    white-space: nowrap;
    text-decoration: none;
    transition:
      background var(--duration-quick) var(--ease-soft),
      translate var(--duration-quick) var(--ease-soft);
  }
  .pill:hover {
    background: color-mix(in srgb, var(--primary) 88%, var(--ink));
  }
  .pill:active {
    translate: 0 1px;
  }
  /* a drawn arrow, the same stroke as the receipt's marks */
  .go {
    position: relative;
    flex: none;
    width: 14px;
    height: 2px;
    border-radius: 2px;
    background: currentColor;
    transition: translate var(--duration-quick) var(--ease-soft);
  }
  .go::after {
    content: '';
    position: absolute;
    right: -1px;
    top: -4px;
    width: 8px;
    height: 8px;
    border: solid currentColor;
    border-width: 2px 2px 0 0;
    border-radius: 1px;
    rotate: 45deg;
  }
  .pill:hover .go {
    translate: 3px 0;
  }
  .lg .pill {
    min-height: 52px;
    padding: 0 22px 0 24px;
    font-size: 16px;
  }
  .sm .pill {
    min-height: 44px;
    padding: 0 14px 0 16px;
    font-size: 14px;
  }
  .sm .go {
    display: none;
  }
  .after .pill {
    background: var(--spark);
    color: #0a100d;
  }
  .after .pill:hover {
    background: color-mix(in srgb, var(--spark) 88%, #fff);
  }
  @media (max-width: 419px) {
    .minha {
      display: none;
    }
  }
  .note {
    font-size: 14px;
    color: var(--ink-muted);
  }
  .after .note {
    color: var(--after-muted);
  }
  .note :global(a) {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding-inline: 2px;
    color: var(--ink);
    font-weight: 600;
    text-decoration-color: color-mix(in srgb, var(--spark) 70%, transparent);
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
  }
  .after .note :global(a) {
    color: var(--after-ink);
  }
  .note :global(a:hover) {
    text-decoration-color: var(--spark);
  }
</style>
