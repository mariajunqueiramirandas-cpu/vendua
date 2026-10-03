<script lang="ts">
  // The few line icons the admin's order card shows (its Phosphor set, redrawn simply).
  type Name = 'bell' | 'check' | 'pot' | 'bag' | 'moped' | 'seal' | 'timer';
  let { name }: { name: Name } = $props();
</script>

<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  {#if name === 'bell'}
    <path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4" />
  {:else if name === 'check'}
    <circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.7L16.5 9.5" />
  {:else if name === 'pot'}
    <path d="M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM2 10h20M9 3v3M12 3v3M15 3v3" />
  {:else if name === 'bag'}
    <path d="M4 8h16l-1 12H5zM9 8V6a3 3 0 0 1 6 0v2" />
  {:else if name === 'moped'}
    <circle cx="6" cy="17" r="2.5" /><circle cx="18" cy="17" r="2.5" /><path
      d="M8.5 17h6l2-7h-3M16.5 10 15 6h-2M3 13h6l1 4"
    />
  {:else if name === 'seal'}
    <path
      d="M12 2.5 14.3 4l2.7-.2 1 2.5 2.3 1.4-.6 2.7.9 2.6-2 1.8-.5 2.7-2.7.4L13.7 20 12 21.5 10.3 20l-2.7-.4-.5-2.7-2-1.8.9-2.6-.6-2.7L7 6.3 8 3.8l2.7.2z"
    /><path d="m8.5 12 2.4 2.4 4.6-4.8" />
  {:else if name === 'timer'}
    <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M10 2h4" />
  {/if}
</svg>

<style>
  svg {
    width: 1.15em;
    height: 1.15em;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
