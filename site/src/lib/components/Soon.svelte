<script lang="ts">
  import type { Snippet } from 'svelte';
  import { site } from '$lib/content';

  // The one call to action until sign-up opens. It looks like the primary button but isn't one:
  // there's nothing to click yet, so it's a status, not a link. `children` replaces `note` when the
  // note needs markup (the Instagram link).
  let {
    size = 'lg',
    tone = 'day',
    note,
    children,
  }: { size?: 'sm' | 'lg'; tone?: 'day' | 'after'; note?: string; children?: Snippet } = $props();
</script>

<p class="soon {size} {tone}">
  <span class="pill">{site.soon}</span>
  {#if children}<span class="note">{@render children()}</span>
  {:else if note}<span class="note">{note}</span>{/if}
</p>

<style>
  .soon {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    margin: 0;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-md);
    font-weight: 600;
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: var(--shadow-e1);
    white-space: nowrap;
  }
  .lg .pill {
    min-height: 52px;
    padding: 0 24px;
    font-size: 16px;
  }
  .sm .pill {
    min-height: 40px;
    padding: 0 16px;
    font-size: 14px;
  }
  .after .pill {
    background: var(--spark);
    color: #0a100d;
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
