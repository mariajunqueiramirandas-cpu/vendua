<script lang="ts">
  import type { Board } from './dados';
  import { brl } from './money';

  // The rest of the Resultados board: funnel, ticket, what selling added, speed, handoffs.
  let { b }: { b: Board } = $props();

  const f = $derived(b.funnel);
  const steps = $derived([
    { label: 'Conversas', value: f.conversations },
    { label: 'Montaram sacola', value: f.carts },
    { label: 'Viram o resumo', value: f.summaries },
    { label: 'Fecharam', value: f.orders },
  ]);
  const share = $derived(f.conversations ? Math.round((f.orders / f.conversations) * 100) : 0);
  const avg = $derived(b.closed.orders ? Math.round(b.closed.cents / b.closed.orders) : 0);
  const ticketTop = $derived(Math.max(avg, b.siteAverageCents));
  const handed = $derived(b.handoffs.reduce((n, h) => n + h.count, 0));
  const handTop = $derived(Math.max(1, ...b.handoffs.map((h) => h.count)));
  // the speed strip runs to a minute; p95 beyond it would sit at the end
  const SPAN = 60;
  const at = (s: number) => `${(Math.min(s, SPAN) / SPAN) * 100}%`;
  const vezes = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<div class="det">
  <section class="block" aria-label="Da conversa ao pedido">
    <div class="row-head">
      <p class="h">Da conversa ao pedido</p>
      <p class="side tnum">{share}% fecharam</p>
    </div>
    <ol class="funnel">
      {#each steps as s (s.label)}
        <li>
          <span class="bar" style:width="{(s.value / f.conversations) * 100}%"></span>
          <span class="lbl">{s.label}</span>
          <span class="val tnum">{s.value}</span>
        </li>
      {/each}
    </ol>
  </section>

  <section class="block" aria-label="Ticket médio">
    <p class="h">Ticket médio</p>
    <dl class="pair">
      <div>
        <dt>com o Duá</dt>
        <dd class="tnum">{brl(avg)}</dd>
        <dd class="meter" aria-hidden="true">
          <span style:width="{(avg / ticketTop) * 100}%"></span>
        </dd>
      </div>
      <div>
        <dt>no site</dt>
        <dd class="tnum">{brl(b.siteAverageCents)}</dd>
        <dd class="meter site" aria-hidden="true">
          <span style:width="{(b.siteAverageCents / ticketTop) * 100}%"></span>
        </dd>
      </div>
    </dl>
  </section>

  <section class="block lines" aria-label="Mais do painel">
    <div class="line">
      <p class="h">Sugestões</p>
      <p class="d tnum">
        {vezes(b.suggestions.offered, 'oferecida', 'oferecidas')}, {vezes(
          b.suggestions.taken,
          'aceita',
          'aceitas',
        )}
      </p>
      <p class="v tnum">+{brl(b.suggestions.revenueCents)}</p>
    </div>
    <div class="line">
      <p class="h">Recuperados</p>
      <p class="d tnum">{vezes(b.recovered.orders, 'pedido', 'pedidos')} de sacolas paradas</p>
      <p class="v tnum">{brl(b.recovered.cents)}</p>
    </div>
    <div class="line speed">
      <p class="h">Respondeu em {b.replySec.p50} s</p>
      <p class="d tnum">na metade das vezes; {b.replySec.p95} s quase sempre</p>
      <div class="strip" aria-hidden="true">
        <span
          class="range"
          style:left={at(b.replySec.p50)}
          style:width="calc({at(b.replySec.p95)} - {at(b.replySec.p50)})"
        ></span>
        <span class="dot p50" style:left={at(b.replySec.p50)}></span>
        <span class="dot p95" style:left={at(b.replySec.p95)}></span>
        <span class="tick" style:left="0%">0 s</span>
        <span class="tick" style:left="50%">30 s</span>
        <span class="tick end" style:left="100%">1 min</span>
      </div>
    </div>
    <div class="line">
      <p class="h">Passou para você</p>
      <p class="v tnum">{handed}</p>
      <ul class="reasons">
        {#each b.handoffs as h (h.reason)}
          <li>
            <span class="rl">{h.reason}</span>
            <span class="rb"><span style:width="{(h.count / handTop) * 100}%"></span></span>
            <span class="rn tnum">{h.count}</span>
          </li>
        {/each}
      </ul>
    </div>
  </section>

  <section class="block week" aria-label="Para esta semana">
    <p class="h">Para esta semana</p>
    <p class="prop">Ensinar a resposta: “vocês escrevem o nome no bolo?”</p>
    <p class="d">Perguntaram 3×. No app, o botão ensinar fica do lado.</p>
  </section>
</div>

<style>
  .det {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  @media (min-width: 560px) {
    .det {
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    }
    .lines,
    .week {
      grid-column: 1 / -1;
    }
  }
  .block {
    display: grid;
    align-content: start;
    gap: 10px;
    padding: 16px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    min-width: 0;
  }
  .det p {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink);
  }
  .det p.h {
    font-weight: 650;
  }
  .det p.side,
  .det p.d {
    color: var(--ink-muted);
    font-size: 0.8125rem;
  }
  .row-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .det ol,
  .det ul {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .det li {
    font-size: 0.875rem;
    line-height: 1.3;
    color: var(--ink);
  }
  .funnel li {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 10px;
  }
  .funnel .bar {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 6px;
    background: var(--primary);
    opacity: 0.16;
  }
  .funnel li:last-child .bar {
    opacity: 1;
    background: var(--spark);
  }
  .funnel .lbl,
  .funnel .val {
    position: relative;
  }
  .funnel li:last-child .lbl {
    color: var(--on-spark);
    font-weight: 650;
  }
  .val {
    font-weight: 600;
  }
  .pair {
    display: grid;
    gap: 12px;
    margin: 0;
  }
  .pair div {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: 4px 10px;
  }
  .pair dt {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .pair dd {
    margin: 0;
    font: 600 1.25rem/1.2 var(--font-display);
    color: var(--ink);
  }
  .meter {
    grid-column: 1 / -1;
    height: 8px;
    border-radius: 999px;
    background: var(--surface);
    overflow: hidden;
  }
  .meter > span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--primary);
  }
  .meter.site > span {
    background: var(--ink-muted);
  }
  .lines {
    gap: 0;
    padding-block: 4px;
  }
  .line {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 12px;
    padding: 12px 0;
  }
  .line + .line {
    border-top: 1px solid var(--line);
  }
  .line .d {
    grid-column: 1;
  }
  .line .v {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    font-weight: 650;
  }
  .speed .strip {
    grid-column: 1 / -1;
    position: relative;
    height: 34px;
    margin: 8px 14px 0 6px;
    border-top: 6px solid var(--surface);
    border-radius: 3px;
  }
  .range {
    position: absolute;
    top: -6px;
    height: 6px;
    background: var(--primary);
    opacity: 0.35;
  }
  .dot {
    position: absolute;
    top: -9px;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    border-radius: 50%;
    background: var(--primary);
    box-shadow: 0 0 0 2px var(--surface-sunken);
  }
  .dot.p95 {
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 2px var(--primary);
  }
  .tick {
    position: absolute;
    top: 8px;
    transform: translateX(-50%);
    font-size: 0.75rem;
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .tick:first-of-type {
    transform: none;
  }
  .tick.end {
    transform: translateX(-100%);
  }
  .reasons {
    grid-column: 1 / -1;
    margin-top: 8px !important;
  }
  .reasons li {
    display: grid;
    grid-template-columns: 8.5rem minmax(0, 1fr) 2ch;
    align-items: center;
    gap: 10px;
  }
  .rl {
    color: var(--ink-muted);
    font-size: 0.8125rem;
  }
  .rb {
    height: 10px;
    border-radius: 999px;
    background: var(--surface);
    overflow: hidden;
  }
  .rb > span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--warning);
  }
  .rn {
    text-align: right;
    font-weight: 600;
  }
  .det p.prop {
    font-weight: 600;
  }
</style>
