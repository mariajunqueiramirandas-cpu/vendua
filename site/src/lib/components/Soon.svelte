<script lang="ts">
  import { site } from '$lib/content';

  // The one call to action until sign-up opens. It looks like the primary button but isn't one:
  // there's nothing to click yet, so it's a status, not a link.
  let {
    size = 'lg',
    tone = 'day',
    note,
  }: { size?: 'sm' | 'lg'; tone?: 'day' | 'after'; note?: string } = $props();
</script>

<p class="soon {size} {tone}">
  <span class="pill"><i aria-hidden="true"></i>{site.soon}</span>
  {#if note}<span class="note">{note}</span>{/if}
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
    gap: 10px;
    border-radius: var(--radius-md);
    font-weight: 600;
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: var(--shadow-e1);
    white-space: nowrap;
  }
  .lg .pill {
    min-height: 52px;
    padding: 0 22px 0 18px;
    font-size: 16px;
  }
  .sm .pill {
    min-height: 40px;
    padding: 0 14px 0 12px;
    font-size: 14px;
  }
  .after .pill {
    background: var(--spark);
    color: #0a100d;
  }
  i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--spark);
    animation: beat 2.4s ease-in-out infinite;
  }
  .after i {
    background: #123c32;
  }
  /* in Noite the pill itself is lime, so the live dot takes the pill's text colour */
  @media (prefers-color-scheme: dark) {
    .day i {
      background: var(--on-primary);
    }
  }
  .note {
    font-size: 14px;
    color: var(--ink-muted);
  }
  .after .note {
    color: var(--after-muted);
  }
  @keyframes beat {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgb(217 248 117 / 0.6);
    }
    60% {
      box-shadow: 0 0 0 7px rgb(217 248 117 / 0);
    }
  }
</style>
