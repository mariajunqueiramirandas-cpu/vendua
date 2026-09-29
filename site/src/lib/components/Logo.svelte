<script lang="ts">
  // The Venduá check mark + wordmark, as live text so it's crisp and themeable.
  let { tone = 'day', size = 24 }: { tone?: 'day' | 'after'; size?: number } = $props();
</script>

<span class="logo {tone}" style="--size: {size}px">
  <svg viewBox="0 0 128 128" aria-hidden="true">
    <path
      d="M32 48 L61 88 L98 34"
      fill="none"
      stroke="currentColor"
      stroke-width="17"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
  <span>venduá<span class="dot">.</span></span>
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: calc(var(--size) * 0.3);
    font: 700 var(--size) / 1 var(--font-display);
    letter-spacing: -0.035em;
    color: var(--ink);
    white-space: nowrap;
  }
  svg {
    width: calc(var(--size) * 1.05);
    height: calc(var(--size) * 1.05);
  }
  .after svg,
  .after .dot {
    color: var(--spark);
  }
</style>
