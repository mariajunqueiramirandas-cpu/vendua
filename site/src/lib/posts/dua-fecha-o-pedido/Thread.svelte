<script lang="ts">
  import { fly } from 'svelte/transition';
  import Dua, { type Pose } from '$lib/components/Dua.svelte';
  import { address, brl, ORDER_NUMBER, type Msg, type Seg } from './flow';

  // The store's WhatsApp, the shopper's side, drawn like the home page's Duá demo: Duá's words in
  // lime bubbles with its face on a lit disc, Core's cards on paper ("calculado pela loja", the
  // wording of packages/core/src/vendedor/cards.ts). `draft` shows Duá's text as it writes it: the
  // figures are holes the store's numbers fill.
  let {
    msgs,
    typing,
    draft,
    anim,
    placed,
  }: { msgs: Msg[]; typing: boolean; draft: boolean; anim: boolean; placed: boolean } = $props();

  const theirs = (m: Msg | undefined) => !!m && m.kind !== 'me';
  const tail = (i: number) =>
    theirs(msgs[i]) && !theirs(msgs[i + 1]) && !(typing && i === msgs.length - 1);
  const poseAt = (i: number): Pose =>
    placed && i === msgs.length - 1 ? 'avatar-feliz' : 'avatar-ola';
  // a new message rises in; the ones already there (and reduced motion) stay put
  const enter = $derived({ y: 6, duration: anim ? 280 : 0 });
  const isFig = (s: Seg): s is { label: string; cents: number } => typeof s !== 'string';
</script>

{#snippet face(pose: Pose)}
  <span class="face" aria-hidden="true"><Dua {pose} size={40} /></span>
{/snippet}

{#snippet mark()}
  <span class="mark">
    <svg viewBox="0 0 16 16" aria-hidden="true"
      ><path d="M8 1.6 2.6 3.6v3.9c0 3.2 2.3 5.8 5.4 6.9 3.1-1.1 5.4-3.7 5.4-6.9V3.6Z" /><path
        d="m5.6 8 1.7 1.7 3.2-3.3"
      /></svg
    >
    calculado pela loja
  </span>
{/snippet}

<div class="wa">
  <div class="bar">
    <span class="avatar" aria-hidden="true">B</span>
    <span class="who">
      <strong>Bolos da Nena</strong>
      <span>Duá, assistente virtual</span>
    </span>
  </div>
  <!-- a scrolling region must be reachable by keyboard -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="scroll" tabindex="0" role="region" aria-label="Mensagens da conversa">
    <div class="log" role="log" aria-live="polite" aria-label="Conversa da Bia com a loja">
      {#each msgs as m, i (i)}
        {#if m.kind === 'me'}
          <div class="me-wrap" in:fly={enter}>
            <div class="msg me">
              <span class="sr-only">Bia:</span>
              <p>{m.text}</p>
            </div>
            {#if m.verdict}
              <p class="verdict" class:yes={m.verdict.yes}>
                <span class="glyph" aria-hidden="true">{m.verdict.yes ? '✓' : '×'}</span>
                <span>
                  {#if m.verdict.yes}
                    <strong>Sim ao resumo {m.verdict.summary}</strong>: {m.verdict.why}
                  {:else}
                    <strong>Não é um sim</strong>: {m.verdict.why}
                  {/if}
                </span>
              </p>
            {/if}
          </div>
        {:else if m.kind === 'dua'}
          <div class="msg dua" in:fly={enter}>
            <span class="sr-only">Duá:</span>
            <p>
              {#each m.segs as s, j (j)}{#if isFig(s)}{#if draft}<span class="hole"
                      ><span class="sr-only">espaço para o valor de </span>{s.label}</span
                    >{:else}<span class="fig">{brl(s.cents)}</span>{/if}{:else}{s}{/if}{/each}
            </p>
            {#if tail(i)}{@render face(poseAt(i))}{/if}
          </div>
        {:else if m.kind === 'summary'}
          <div class="card-wrap" class:old={m.replacedBy} in:fly={enter}>
            <p class="tab">
              resumo {m.n}{#if m.replacedBy}<span>, trocado pelo {m.replacedBy}</span>{/if}
            </p>
            <figure class="msg paper receipt">
              <figcaption><span>Seu pedido</span>{@render mark()}</figcaption>
              <table>
                <caption class="sr-only">
                  Resumo {m.n}, calculado pela loja: total {brl(m.totalCents)}{m.replacedBy
                    ? `, trocado pelo resumo ${m.replacedBy}`
                    : ''}
                </caption>
                <tbody>
                  {#each m.lines as l (l.text)}
                    <tr><td>{l.text}</td><td class="num">{brl(l.cents)}</td></tr>
                  {/each}
                  {#if m.mode === 'delivery'}
                    <tr><td>Entrega (40–60 min)</td><td class="num">{brl(m.feeCents)}</td></tr>
                  {/if}
                </tbody>
                <tfoot>
                  <tr><th scope="row">Total</th><td class="num total">{brl(m.totalCents)}</td></tr>
                </tfoot>
              </table>
              <p class="meta">
                {m.mode === 'delivery' ? `Entrega em: ${address}` : 'Retirada na loja'}<br />
                Pagamento: Pix
              </p>
              <p class="ask">Está tudo certo? Responda <strong>sim</strong> para confirmar.</p>
              {#if tail(i)}{@render face(poseAt(i))}{/if}
            </figure>
          </div>
        {:else if m.kind === 'pix'}
          <figure class="msg paper" in:fly={enter}>
            <figcaption><span>Pix</span>{@render mark()}</figcaption>
            <p class="lead">
              Pix do pedido #{ORDER_NUMBER}: <strong class="num">{brl(m.totalCents)}</strong>
            </p>
            <p class="meta">Copie o código e cole no app do seu banco, em Pix copia e cola.</p>
            <p class="code" aria-hidden="true">00020126580014br.gov.bcb.pix0136nena-5f2e-4b1a</p>
            {#if tail(i)}{@render face(poseAt(i))}{/if}
          </figure>
        {/if}
      {/each}
      {#if typing}
        <div class="msg dua typing">
          <span class="sr-only">Duá está escrevendo</span>
          <span class="dot" aria-hidden="true"></span><span class="dot" aria-hidden="true"
          ></span><span class="dot" aria-hidden="true"></span>
          {@render face('avatar-pensando')}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .wa {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--ink);
    font-size: 0.9375rem;
    line-height: 1.4;
    --dua-bg: var(--spark-soft);
    --dua-edge: color-mix(in srgb, var(--spark) 88%, var(--ink-muted));
    --me-bg: var(--primary);
    --me-ink: var(--on-primary);
  }
  @media (prefers-color-scheme: dark) {
    .wa {
      --dua-edge: color-mix(in srgb, var(--spark) 30%, transparent);
      --me-bg: color-mix(in srgb, var(--success) 24%, var(--surface));
      --me-ink: var(--ink);
    }
  }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .avatar {
    width: 34px;
    height: 34px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--spark);
    color: var(--on-spark);
    font: 600 1rem/1 var(--font-display);
  }
  .who {
    display: grid;
    line-height: 1.25;
  }
  .who strong {
    font-weight: 650;
    font-size: 0.9375rem;
  }
  .who span {
    color: var(--ink-muted);
    font-size: 0.8125rem;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: auto;
    scrollbar-width: thin;
    display: flex;
    flex-direction: column-reverse;
  }
  .scroll:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }
  .log {
    --gut: 46px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 12px 16px;
  }
  .msg {
    max-width: 86%;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .msg:not(.me) {
    position: relative;
    margin-left: var(--gut);
  }
  .face {
    position: absolute;
    left: calc(-1 * var(--gut));
    bottom: 0;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--spark-soft);
    overflow: hidden;
  }
  .face :global(.dua) {
    display: block;
    width: 100%;
  }
  @media (prefers-color-scheme: dark) {
    .face {
      background: var(--after-ink);
    }
  }
  div.wa p {
    margin: 0;
    font-size: inherit;
    line-height: inherit;
    color: inherit;
  }
  .dua,
  .me {
    padding: 7px 12px 8px;
    border-radius: 18px;
  }
  .dua {
    align-self: flex-start;
    border-bottom-left-radius: 6px;
    background: var(--dua-bg);
    box-shadow: inset 0 0 0 1px var(--dua-edge);
  }
  .me-wrap {
    align-self: flex-end;
    max-width: 86%;
    display: grid;
    justify-items: end;
    gap: 4px;
  }
  .me {
    max-width: 100%;
    border-bottom-right-radius: 6px;
    background: var(--me-bg);
    color: var(--me-ink);
  }
  .wa .verdict {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 4px 10px 5px;
    border-radius: 10px;
    background: var(--warning-soft);
    color: var(--ink);
    font-size: 0.8125rem;
    line-height: 1.35;
  }
  .wa .verdict.yes {
    background: var(--success-soft);
  }
  .verdict .glyph {
    font-weight: 700;
    color: var(--warning);
  }
  .verdict.yes .glyph {
    color: var(--success);
  }
  .wa .verdict strong {
    color: inherit;
    font-weight: 650;
  }
  /* a figure the store's ledger filled in */
  .fig {
    white-space: nowrap;
    font-family: var(--font-display);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-decoration: underline 2px color-mix(in srgb, var(--success) 55%, transparent);
    text-underline-offset: 3px;
  }
  /* the same spot in Duá's draft: a hole with a name, never a number */
  .hole {
    display: inline-block;
    padding: 0 7px;
    border: 1.5px dashed var(--ink-muted);
    border-radius: 6px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--ink-muted);
    font-weight: 600;
  }
  .typing {
    display: flex;
    gap: 5px;
    padding: 13px 16px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink);
    opacity: 0.35;
    animation: dot 1s ease-in-out infinite;
  }
  .dot:nth-child(3) {
    animation-delay: 160ms;
  }
  .dot:nth-child(4) {
    animation-delay: 320ms;
  }
  @keyframes dot {
    50% {
      opacity: 0.8;
    }
  }

  .card-wrap {
    display: grid;
    gap: 3px;
    margin-left: var(--gut);
    width: 86%;
    transition: opacity var(--duration-smooth) var(--ease-soft);
  }
  .card-wrap .paper {
    width: 100%;
    margin-left: 0;
  }
  .card-wrap.old {
    opacity: 0.62;
  }
  .card-wrap.old .total {
    text-decoration: line-through 2px;
  }
  .wa .tab {
    font-size: 0.75rem;
    font-weight: 650;
    color: var(--ink-muted);
  }
  .tab span {
    font-weight: 500;
  }
  .paper {
    position: relative;
    width: 86%;
    max-width: none;
    align-self: flex-start;
    padding: 10px 12px 9px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow:
      inset 0 0 0 1px var(--line-strong),
      var(--shadow-e1);
    font-size: 0.875rem;
  }
  @media (prefers-color-scheme: dark) {
    .paper {
      background: var(--surface-raised);
    }
  }
  .receipt::before {
    content: '';
    position: absolute;
    inset: 0 12px auto;
    border-top: 2px dashed var(--line-strong);
  }
  figure.paper figcaption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    max-width: none;
    text-align: left;
    color: var(--ink-muted);
    font-size: 0.75rem;
    line-height: 1.2;
  }
  figure.paper figcaption > span:first-child {
    font-weight: 650;
    font-size: 0.8125rem;
    color: var(--ink);
  }
  .mark {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-weight: 500;
  }
  .mark svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .paper table {
    width: 100%;
    margin-top: 6px;
    border-collapse: collapse;
  }
  .paper td,
  .paper th {
    padding: 2px 0;
    vertical-align: top;
    text-align: left;
    font-weight: inherit;
  }
  .num {
    white-space: nowrap;
    font-family: var(--font-display);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .paper td.num {
    padding-left: 10px;
    text-align: right;
  }
  .paper tfoot tr {
    border-top: 1px solid var(--line);
  }
  .paper tfoot th,
  .paper tfoot td {
    padding-top: 5px;
    font-weight: 700;
  }
  .wa .meta,
  .wa .ask {
    margin-top: 5px;
    color: var(--ink-muted);
    font-size: 0.8125rem;
  }
  .wa .ask strong {
    color: var(--ink);
  }
  .wa .lead {
    margin-top: 5px;
  }
  .wa .code {
    margin-top: 7px;
    padding: 6px 8px;
    border-radius: 8px;
    background: var(--surface-sunken);
    font-size: 0.75rem;
    /* never widens the card: its long code is cut, not measured */
    width: 0;
    min-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
    .card-wrap {
      transition: none;
    }
  }
</style>
