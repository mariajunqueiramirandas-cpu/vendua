<script lang="ts">
  import type { Snippet } from 'svelte';

  // A landscape tablet drawn in CSS around a desktop screenshot (1440×900, 16:10).
  let {
    class: cls = '',
    style = '',
    label,
    children,
  }: { class?: string; style?: string; label?: string; children: Snippet } = $props();
</script>

<div class="tablet {cls}" {style} role={label ? 'img' : undefined} aria-label={label}>
  <div class="body">
    <div class="screen">{@render children()}</div>
    <span class="cam" aria-hidden="true"></span>
  </div>
</div>

<style>
  .tablet {
    width: 100%;
    container-type: inline-size;
  }
  .body {
    position: relative;
    padding: 1.8cqw;
    border-radius: 3.4cqw;
    background: var(--bezel);
    box-shadow:
      inset 0 0 0 1.5px rgb(255 255 255 / 0.08),
      0 8px 16px rgb(18 60 50 / 0.1),
      0 30px 70px rgb(18 60 50 / 0.2);
  }
  .screen {
    overflow: hidden;
    border-radius: 1.8cqw;
    background: var(--app-bg);
  }
  .cam {
    position: absolute;
    top: 50%;
    left: 0.8cqw;
    width: 0.5cqw;
    height: 0.5cqw;
    border-radius: 50%;
    background: #26302b;
    transform: translateY(-50%);
  }
</style>
