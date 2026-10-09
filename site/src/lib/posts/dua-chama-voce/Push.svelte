<script lang="ts">
  // A phone notification drawn as system UI, with Core's real push text (admin/workers.ts).
  let {
    title,
    body,
    when = 'agora',
    action = '',
    app = 'Minha loja',
    muted = false,
  }: {
    title: string;
    body: string;
    when?: string;
    action?: string;
    app?: string;
    muted?: boolean;
  } = $props();
</script>

<div class="push" class:muted>
  <span class="icon" aria-hidden="true"><span></span></span>
  <p class="app">{app}</p>
  <p class="when">{when}</p>
  <p class="title">{title}</p>
  <p class="body">{body}</p>
  {#if action}<span class="act">{action}</span>{/if}
</div>

<style>
  .push {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    grid-template-areas:
      'icon app when'
      'icon title title'
      'icon body body'
      'act act act';
    column-gap: 10px;
    row-gap: 1px;
    padding: 12px 14px;
    border-radius: 18px;
    background: var(--glass);
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-e1);
    text-align: left;
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
  }
  .push.muted {
    opacity: 0.55;
  }
  .icon {
    grid-area: icon;
    align-self: start;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--primary);
  }
  .icon span {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--spark);
    box-shadow: 0 0 0 2px var(--on-primary);
  }
  .push p {
    margin: 0;
    min-width: 0;
    color: var(--ink);
  }
  .push p.app {
    grid-area: app;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .push p.when {
    grid-area: when;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .push p.title {
    grid-area: title;
    font-size: 0.9375rem;
    line-height: 1.35;
    font-weight: 650;
  }
  .push p.body {
    grid-area: body;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink);
  }
  .act {
    grid-area: act;
    justify-self: start;
    margin-top: 8px;
    margin-left: 38px;
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--surface-sunken);
    font-size: 0.8125rem;
    font-weight: 650;
    color: var(--ink);
  }
</style>
