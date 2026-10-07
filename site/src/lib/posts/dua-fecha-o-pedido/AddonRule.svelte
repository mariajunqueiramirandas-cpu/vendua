<script lang="ts">
  // The add-on rule as a path: the `suggest` and `offer_suggestion` tools
  // (agent-host/agents/vendedor/tools-conversation.ts) and the prompt's rule (prompt.ts: one per
  // order, never on a complaint, never after "só isso", never again after a no). The visitor flips
  // the answers; the path lights up to where it stops.
  let { live }: { live: boolean } = $props();

  interface Step {
    id: string;
    q: string;
    /** the answer that lets the path go on */
    go: boolean;
    stop: string;
  }
  const steps: Step[] = [
    {
      id: 'liga',
      q: 'A loja deixa o Duá sugerir adicionais?',
      go: true,
      stop: 'Você desligou as sugestões: ele não oferece nada.',
    },
    {
      id: 'ja',
      q: 'Já houve uma sugestão neste pedido?',
      go: false,
      stop: 'Uma por pedido. A segunda nem chega a sair.',
    },
    {
      id: 'reclama',
      q: 'O cliente está reclamando?',
      go: false,
      stop: 'Reclamação não é hora de vender: ele chama a loja.',
    },
    {
      id: 'chega',
      q: 'O cliente disse “só isso” ou já recusou?',
      go: false,
      stop: 'Ele respeita e segue para o resumo.',
    },
    {
      id: 'tem',
      q: 'A conta da loja achou uma sugestão boa para essa sacola?',
      go: true,
      stop: 'Sem uma boa, ele não inventa: segue para o resumo.',
    },
  ];

  const a: Record<string, boolean> = $state(Object.fromEntries(steps.map((s) => [s.id, s.go])));
  const stopAt = $derived(steps.findIndex((s) => a[s.id] !== s.go));
  const yes = $derived(stopAt === -1);
</script>

<div class="tree">
  <ol class="path">
    {#each steps as s, i (s.id)}
      {@const reached = stopAt === -1 || i <= stopAt}
      {@const stopsHere = i === stopAt}
      <li class:reached class:stops={stopsHere}>
        <span class="node" aria-hidden="true"></span>
        <div class="q">
          <p id="q-{s.id}">{s.q}</p>
          <div class="yn" role="group" aria-labelledby="q-{s.id}">
            {#each [true, false] as v (v)}
              <button
                type="button"
                aria-pressed={a[s.id] === v}
                disabled={!live}
                onclick={() => (a[s.id] = v)}>{v ? 'sim' : 'não'}</button
              >
            {/each}
          </div>
        </div>
        {#if stopsHere}
          <p class="exit"><span aria-hidden="true">×</span> {s.stop}</p>
        {/if}
      </li>
    {/each}
  </ol>
  <p class="leaf" class:on={yes} aria-live="polite">
    {#if yes}
      <strong>Ele sugere uma coisa</strong>, em uma frase, sem insistir, com o motivo que a conta da
      loja deu.
    {:else}
      <strong>Nenhuma sugestão desta vez.</strong> O pedido segue normal.
    {/if}
  </p>
</div>

<style>
  .tree {
    display: grid;
    gap: 4px;
    padding: 18px 16px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow:
      inset 0 0 0 1px var(--line),
      var(--shadow-e1);
    color: var(--ink);
  }
  div.tree p {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.4;
    color: var(--ink);
  }
  div.tree ol.path {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  ol.path li {
    position: relative;
    display: grid;
    gap: 6px;
    padding: 0 0 16px 30px;
    font-size: 0.9375rem;
    opacity: 0.45;
    transition: opacity var(--duration-smooth) var(--ease-soft);
  }
  ol.path li.reached {
    opacity: 1;
  }
  /* the path: a line from node to node, lit while the order goes on */
  ol.path li::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 14px;
    bottom: -6px;
    border-left: 3px solid var(--line-strong);
  }
  ol.path li.reached:not(.stops)::before {
    border-left-color: var(--success);
  }
  .node {
    position: absolute;
    left: 1px;
    top: 4px;
    width: 17px;
    height: 17px;
    border-radius: 4px;
    transform: rotate(45deg);
    background: var(--surface);
    box-shadow: inset 0 0 0 3px var(--line-strong);
  }
  li.reached .node {
    background: var(--spark);
    box-shadow: inset 0 0 0 2px var(--success);
  }
  li.stops .node {
    background: var(--danger-soft);
    box-shadow: inset 0 0 0 2px var(--danger);
  }
  .q {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 12px;
  }
  .q p {
    flex: 1 1 14rem;
  }
  .yn {
    display: inline-flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface-sunken);
  }
  .yn button {
    min-width: 56px;
    min-height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-muted);
    font: 600 0.9375rem/1 var(--font-sans);
    cursor: pointer;
  }
  .yn button[aria-pressed='true'] {
    background: var(--primary);
    color: var(--on-primary);
  }
  .yn button:disabled {
    cursor: default;
  }
  .yn button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  div.tree .exit {
    display: flex;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--danger-soft);
    font-size: 0.875rem;
    font-weight: 600;
  }
  .exit span {
    color: var(--danger);
    font-weight: 700;
  }
  div.tree .leaf {
    margin-left: 30px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--surface-sunken);
    color: var(--ink-muted);
  }
  div.tree .leaf.on {
    background: var(--spark-soft);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success) 35%, transparent);
  }
  .leaf strong {
    color: var(--ink);
  }
  @media (prefers-reduced-motion: reduce) {
    ol.path li {
      transition: none;
    }
  }
</style>
