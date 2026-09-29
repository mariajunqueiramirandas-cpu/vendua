<script lang="ts">
  import { push } from '$lib/content';

  // The new-order push exactly as Core sends it: "Pedido #29 chegou" / "Luiz · R$ 219,00 · entrega".
  // `variant="banner"` floats over a page (light glass); `"lock"` sits on a lock screen and scales with
  // the phone it's in (container units).
  let {
    number,
    customer,
    total,
    mode,
    when = 'agora',
    action = false,
    fresh = false,
    variant = 'banner',
    class: cls = '',
  }: {
    number: number;
    customer: string;
    total: string;
    mode: string;
    when?: string;
    action?: boolean;
    fresh?: boolean;
    variant?: 'banner' | 'lock';
    class?: string;
  } = $props();
</script>

<div class="note {variant} {cls}" class:fresh>
  <img src="/assets/brand/app-icon.png" alt="" width="192" height="192" />
  <p class="app">{push.app}</p>
  <p class="when">{when}</p>
  <p class="title">{push.title(number)}</p>
  <p class="body">{push.body({ customer, total, mode })}</p>
  {#if action}<span class="act">{push.action}</span>{/if}
</div>

<style>
  .note {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'icon app when'
      'icon title title'
      'icon body body'
      'act act act';
    column-gap: 10px;
    align-items: center;
    text-align: left;
  }
  img {
    grid-area: icon;
    align-self: start;
    border-radius: 22%;
  }
  p {
    margin: 0;
    min-width: 0;
  }
  .app {
    grid-area: app;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    opacity: 0.7;
  }
  .when {
    grid-area: when;
    opacity: 0.7;
  }
  .title {
    grid-area: title;
    font-weight: 700;
  }
  .body {
    grid-area: body;
  }
  .act {
    grid-area: act;
    text-align: center;
    font-weight: 600;
  }

  /* floating over the page */
  .banner {
    width: 264px;
    max-width: 100%;
    padding: 12px 14px;
    border-radius: 20px;
    background: rgb(255 253 248 / 0.9);
    backdrop-filter: blur(14px) saturate(1.3);
    -webkit-backdrop-filter: blur(14px) saturate(1.3);
    box-shadow:
      0 0 0 1px rgb(18 60 50 / 0.06),
      0 18px 40px rgb(18 60 50 / 0.18);
    color: #123c32;
    font: 500 13px/1.3 var(--font-sans);
  }
  .banner img {
    width: 36px;
    height: 36px;
  }
  .banner .app,
  .banner .when {
    font-size: 11px;
  }
  .banner .title {
    font-size: 14px;
    margin-top: 2px;
  }
  .banner .body {
    color: #4f6a5e;
  }
  .banner .act {
    margin-top: 10px;
    padding: 8px;
    border-radius: 10px;
    background: #123c32;
    color: #f7f4ea;
  }

  /* on a lock screen: sizes follow the phone */
  .lock {
    width: 100%;
    column-gap: 2.6cqw;
    padding: 3.6cqw;
    border-radius: 6.4cqw;
    background: rgb(247 244 234 / 0.16);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: #f7f4ea;
    font: 500 4.3cqw/1.3 var(--font-sans);
  }
  .lock img {
    width: 10cqw;
    height: 10cqw;
  }
  .lock .app,
  .lock .when {
    font-size: 3.4cqw;
  }
  .lock.fresh {
    background: rgb(247 244 234 / 0.95);
    color: #123c32;
  }
  .lock .act {
    margin-top: 2.6cqw;
    padding: 2cqw;
    border-radius: 3.2cqw;
    background: #123c32;
    color: #f7f4ea;
  }

  .fresh {
    animation: drop 700ms cubic-bezier(0.2, 0.8, 0.25, 1.15) 500ms both;
  }
  @keyframes drop {
    from {
      transform: translateY(-20px) scale(0.97);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
</style>
