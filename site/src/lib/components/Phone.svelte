<script lang="ts">
  import type { Snippet } from 'svelte';

  // A phone drawn in CSS. Everything inside scales with the phone's width (container units),
  // so the same frame works at 180 px and at 340 px. `status` adds the status bar above a screenshot;
  // leave it off when the content draws its own (the lock screen).
  let {
    width = 280,
    time = '9:41',
    status = true,
    label,
    class: cls = '',
    style = '',
    children,
  }: {
    width?: number;
    time?: string;
    status?: boolean;
    label?: string;
    class?: string;
    style?: string;
    children: Snippet;
  } = $props();
</script>

<div
  class="phone {cls}"
  style="--w: {width}px; {style}"
  role={label ? 'img' : undefined}
  aria-label={label}
>
  <div class="body">
    <div class="screen">
      <span class="island" aria-hidden="true"></span>
      {#if status}
        <div class="status" aria-hidden="true">
          <span>{time}</span>
          <span class="icons"></span>
        </div>
      {/if}
      {@render children()}
    </div>
  </div>
</div>

<style>
  .phone {
    width: min(var(--w), 100%);
    container-type: inline-size;
    flex: none;
  }
  .body {
    padding: 3.2cqw;
    border-radius: 16cqw;
    background: var(--bezel);
    box-shadow:
      inset 0 0 0 1.5px rgb(255 255 255 / 0.08),
      0 8px 16px rgb(18 60 50 / 0.12),
      0 30px 70px rgb(18 60 50 / 0.22);
  }
  /* Noite: the bezel would melt into the night sky without a brighter rim */
  @media (prefers-color-scheme: dark) {
    .body {
      box-shadow:
        inset 0 0 0 1.5px rgb(255 255 255 / 0.18),
        0 0 0 1px rgb(255 255 255 / 0.06),
        0 30px 70px rgb(0 0 0 / 0.45);
    }
  }
  .screen {
    position: relative;
    overflow: hidden;
    border-radius: 13cqw;
    background: var(--app-bg);
    isolation: isolate;
  }
  .island {
    position: absolute;
    z-index: 2;
    top: 2.6cqw;
    left: 50%;
    width: 30%;
    height: 7.4cqw;
    transform: translateX(-50%);
    border-radius: 999px;
    background: #050807;
  }
  .status {
    height: 11cqw;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.4cqw 8% 0 11%;
    background: var(--app-bg);
    color: var(--ink);
    font:
      600 4.3cqw/1 system-ui,
      -apple-system,
      sans-serif;
    letter-spacing: 0.01em;
  }
  /* signal bars + battery, drawn */
  .icons {
    width: 15cqw;
    height: 3.6cqw;
    background:
      linear-gradient(currentColor, currentColor) 0 100% / 1.2cqw 40% no-repeat,
      linear-gradient(currentColor, currentColor) 1.9cqw 100% / 1.2cqw 65% no-repeat,
      linear-gradient(currentColor, currentColor) 3.8cqw 100% / 1.2cqw 90% no-repeat,
      linear-gradient(currentColor, currentColor) 100% 50% / 6.4cqw 100% no-repeat;
    border-radius: 1px;
    opacity: 0.9;
  }
</style>
