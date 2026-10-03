<script lang="ts">
  // The few line icons the kitchen screen uses, drawn after the admin's Phosphor (bold) set.
  let { name }: { name: 'check' | 'fire' | 'bag' | 'moped' | 'dots' | 'undo' | 'pot' } = $props();
</script>

<svg viewBox="0 0 24 24" aria-hidden="true" class="ico">
  {#if name === 'check'}
    <path d="M4.5 12.5l5 5L19.5 7" />
  {:else if name === 'fire'}
    <path
      class="fill"
      d="M12 2.5c.6 3.3 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.5 1.2-4.3 2.6-5.5.2 1.8 1 3 2.2 3.6-.4-3.5-.1-6.3.7-9.1z"
    />
  {:else if name === 'bag'}
    <path d="M5 8h14l-1 12.5H6L5 8zM9 10V7a3 3 0 0 1 6 0v3" />
  {:else if name === 'moped'}
    <circle cx="6" cy="17" r="2.5" /><circle cx="18.5" cy="17" r="2.5" />
    <path d="M8.5 17H15l-1.5-6H9M14 5h2.5l2 9.5M3 12.5h6" />
  {:else if name === 'dots'}
    <circle class="fill" cx="5.5" cy="12" r="1.8" /><circle class="fill" cx="12" cy="12" r="1.8" />
    <circle class="fill" cx="18.5" cy="12" r="1.8" />
  {:else if name === 'undo'}
    <path d="M8.5 14L4 9.5 8.5 5M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11" />
  {:else}
    <path
      d="M4 10.5h16V15a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-4.5zM2 10.5h2M20 10.5h2M9 4.5v2.5M12 4v3M15 4.5v2.5"
    />
  {/if}
</svg>

<style>
  .ico {
    width: 1em;
    height: 1em;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .fill {
    fill: currentColor;
    stroke: none;
  }
</style>
