<script lang="ts">
  import { FUNNEL } from './data';

  // "Do olhar ao pedido", the report's funnel (apps/admin/src/features/reports/Reports.tsx): the
  // same five steps and the same summary line, drawn as one tapering shape. Example counts.
  const max = FUNNEL[0]!.value;
  const w = (v: number) => Math.max(3, (v / max) * 100);
  const rate = ((FUNNEL.at(-1)!.value / max) * 100).toFixed(1).replace('.', ',');
</script>

<figure class="funnel">
  <div class="panel">
    <p class="title">Do olhar ao pedido</p>
    <p class="summary">{rate}% de quem visitou fez pedido.</p>
    <ol>
      {#each FUNNEL as s, i (s.label)}
        {@const prev = FUNNEL[i - 1]}
        {@const next = FUNNEL[i + 1]}
        <li class:last={!next}>
          <span class="shape" aria-hidden="true">
            <span class="bar" style="--w: {w(s.value)}%"></span>
            {#if next}
              <svg class="neck" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon
                  points="{50 - w(s.value) / 2},0 {50 + w(s.value) / 2},0 {50 +
                    w(next.value) / 2},100 {50 - w(next.value) / 2},100"
                />
              </svg>
            {/if}
          </span>
          <span class="text">
            <span class="lbl">{s.label}</span>
            <span class="n tnum"
              ><b>{s.value}</b>{#if prev}, {Math.round((s.value / prev.value) * 100)}% da etapa
                anterior{/if}</span
            >
          </span>
        </li>
      {/each}
    </ol>
  </div>
  <figcaption>
    Exemplo com a Bolos da Nena em 7 dias, com os mesmos 11 pedidos do relatório acima. As etapas e
    a conta do resumo são as do relatório da Venduá.
  </figcaption>
</figure>

<style>
  figure.funnel {
    margin: 12px 0;
    display: grid;
    gap: 14px;
  }
  .panel {
    padding: 22px 18px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  figure.funnel p {
    margin: 0;
  }
  figure.funnel .title {
    font: 600 1.125rem/1.3 var(--font-display);
    color: var(--ink);
  }
  figure.funnel .summary {
    margin-top: 2px;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  figure.funnel ol {
    display: grid;
    gap: 0;
    margin: 20px 0 0;
    padding: 0;
    list-style: none;
  }
  figure.funnel li {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    gap: 16px;
    height: 64px;
    font-size: 1rem;
    line-height: 1.4;
  }
  figure.funnel li.last {
    height: auto;
  }
  .shape {
    position: relative;
    display: flex;
    justify-content: center;
  }
  .bar {
    width: var(--w);
    height: 18px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--ink) 34%, transparent);
  }
  .last .bar {
    background: var(--primary);
  }
  .neck {
    position: absolute;
    top: 18px;
    left: 0;
    width: 100%;
    height: calc(100% - 18px);
  }
  .neck polygon {
    fill: color-mix(in srgb, var(--ink) 10%, transparent);
  }
  .text {
    display: grid;
    align-content: start;
    gap: 1px;
  }
  .lbl {
    font-size: 0.9375rem;
    font-weight: 600;
    line-height: 18px;
    color: var(--ink);
  }
  .n {
    font-size: 0.8125rem;
    line-height: 1.35;
    color: var(--ink-muted);
  }
  .n b {
    font: 600 0.9375rem/1.3 var(--font-display);
    color: var(--ink);
  }
  figure.funnel figcaption {
    max-width: none;
  }
  @media (min-width: 560px) {
    .panel {
      padding: 28px;
    }
    figure.funnel li {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
</style>
