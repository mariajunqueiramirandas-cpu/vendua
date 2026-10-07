<script lang="ts">
  import { push } from '$lib/content';

  // A notification on the lock screen, sized in the phone's container units like
  // components/Notification.svelte, but with real buttons: the body opens the order, the action
  // accepts it. Without `onOpen`/`onAccept` it is plain text (the "Pedido aceito" one).
  let {
    title,
    body,
    when = 'agora',
    onOpen,
    onAccept,
  }: {
    title: string;
    body: string;
    when?: string;
    onOpen?: () => void;
    onAccept?: () => void;
  } = $props();
</script>

<div class="note">
  {#snippet face()}
    <img src="/assets/brand/app-icon.png" alt="" width="192" height="192" />
    <span class="app">{push.app}</span>
    <span class="when">{when}</span>
    <span class="title">{title}</span>
    <span class="body">{body}</span>
  {/snippet}
  {#if onOpen}
    <button
      type="button"
      class="face"
      onclick={onOpen}
      aria-label="{title}, {body}: abrir o pedido"
    >
      {@render face()}
    </button>
  {:else}
    <div class="face" role="status">{@render face()}</div>
  {/if}
  {#if onAccept}
    <button type="button" class="act" onclick={onAccept}>{push.action}</button>
  {/if}
</div>

<style>
  .note {
    width: 100%;
    display: grid;
    gap: 2.4cqw;
    padding: 3.6cqw;
    border-radius: 6.4cqw;
    background: rgb(247 244 234 / 0.95);
    color: #123c32;
    box-shadow: 0 2cqw 6cqw rgb(0 0 0 / 0.25);
    animation: drop 600ms cubic-bezier(0.2, 0.8, 0.25, 1.15) both;
  }
  .face {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'icon app when'
      'icon title title'
      'icon body body';
    column-gap: 2.6cqw;
    align-items: center;
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: 500 4.3cqw/1.3 var(--font-sans);
    text-align: left;
  }
  button.face {
    cursor: pointer;
    border-radius: 3cqw;
  }
  img {
    grid-area: icon;
    align-self: start;
    width: 10cqw;
    height: 10cqw;
    border-radius: 22%;
  }
  .app {
    grid-area: app;
    font-size: 3.4cqw;
    font-weight: 600;
    opacity: 0.75;
  }
  .when {
    grid-area: when;
    font-size: 3.4cqw;
    opacity: 0.75;
  }
  .title {
    grid-area: title;
    font-weight: 700;
  }
  .body {
    grid-area: body;
    color: #3d5a4e;
  }
  .act {
    min-height: 44px;
    border: 0;
    border-radius: 3.2cqw;
    background: #123c32;
    color: #f7f4ea;
    font: 600 4.3cqw/1 var(--font-sans);
    cursor: pointer;
  }
  .act:hover {
    background: #0d2f27;
  }
  .face:focus-visible,
  .act:focus-visible {
    outline: 2px solid #d9f875;
    outline-offset: 2px;
  }
  @keyframes drop {
    from {
      transform: translateY(-14px) scale(0.97);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .note {
      animation: none;
    }
  }
</style>
