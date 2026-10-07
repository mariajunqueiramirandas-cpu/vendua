<script lang="ts">
  import Paper from './Paper.svelte';
  import { renderTicket, type Order } from './ticket';

  // The tablet holding the printer loses its internet at 19:00 while orders keep being accepted on
  // the phone. Core's rules (packages/core/src/modules/printing/jobs.ts and ticket.ts): every job
  // waits for the device; one older than 2 hours expires; one whose order was cancelled while it
  // waited is dropped; one printed more than 10 minutes after it was queued says so at the top.
  // The words are the admin's (apps/admin/src/features/orders/OrderDetail.tsx jobWords).

  const START = 19 * 60;
  const END = 22 * 60 + 30;
  const EXPIRE = 120;
  const LATE = 10;

  const ORDERS = [
    { n: 33, who: 'Júlia', queued: 5 },
    { n: 34, who: 'Paulo', queued: 30 },
    { n: 35, who: 'Lúcia', queued: 40, cancelled: 55 },
    { n: 36, who: 'Davi', queued: 85 },
  ];

  const hm = (m: number) => {
    const t = START + m;
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  const x = (m: number) => `${(m / (END - START)) * 100}%`;

  let back = $state(135);

  type Fate = 'printed' | 'late' | 'expired' | 'cancelled';
  const rows = $derived(
    ORDERS.map((o) => {
      const printsAt = Math.max(back, o.queued);
      let fate: Fate;
      let until: number;
      if (o.cancelled !== undefined && o.cancelled < printsAt) {
        fate = 'cancelled';
        until = o.cancelled;
      } else if (printsAt - o.queued > EXPIRE) {
        fate = 'expired';
        until = o.queued + EXPIRE;
      } else {
        fate = printsAt - o.queued > LATE ? 'late' : 'printed';
        until = printsAt;
      }
      const words =
        fate === 'cancelled'
          ? 'A comanda não saiu: o pedido foi cancelado antes.'
          : fate === 'expired'
            ? 'A comanda não saiu: o aparelho ficou desligado. Imprimir comanda manda de novo.'
            : fate === 'late'
              ? `Impressa às ${hm(printsAt)}, com o aviso de impressão atrasada.`
              : `Impressa às ${hm(printsAt)}.`;
      return { ...o, fate, until, words };
    }),
  );
  const count = (f: Fate) => rows.filter((r) => r.fate === f).length;
  const summary = $derived(
    [
      count('printed') && `${count('printed')} na hora`,
      count('late') && `${count('late')} com aviso de atrasada`,
      count('expired') && `${count('expired')} passou das 2 horas`,
      count('cancelled') && `${count('cancelled')} cancelado, sem papel`,
    ]
      .filter(Boolean)
      .join(', '),
  );

  const lateOne = $derived(rows.find((r) => r.fate === 'late'));
  const sample = $derived.by(() => {
    if (!lateOne) return null;
    const order: Order = {
      number: lateOne.n,
      customer: lateOne.who,
      mode: 'pickup',
      placed: '',
      items: [],
      feeCents: 0,
      payment: '',
      paymentLine: '',
    };
    // the head of the ticket: the notice, the store, the number, how it leaves
    return renderTicket(order, { paper: 58, codepage: 'cp850', late: hm(lateOne.queued) }).slice(
      0,
      6,
    );
  });
</script>

<figure class="off" aria-label="Simulação: o aparelho da impressora fica sem internet">
  <div class="panel">
    <div class="ctl">
      <label for="off-back">A internet do tablet volta às</label>
      <output for="off-back" class="tnum">{hm(back)}</output>
      <input
        id="off-back"
        type="range"
        min="5"
        max={END - START}
        step="5"
        bind:value={back}
        aria-valuetext={`${hm(back)}, ${summary}`}
      />
      <span class="scale tnum" aria-hidden="true"><span>19:05</span><span>22:30</span></span>
    </div>

    <div class="chart">
      <span class="dark" style:width={x(back)} aria-hidden="true">
        <span>sem internet</span>
      </span>
      <span class="back" style:left={x(back)} aria-hidden="true"></span>
      <ol class="rows">
        {#each rows as r (r.n)}
          <li class="row {r.fate}">
            <p class="who">
              <strong class="tnum">#{r.n} {r.who}</strong>, aceito às {hm(r.queued)}
            </p>
            <div class="track" aria-hidden="true">
              <span class="limit" style:left={x(r.queued + EXPIRE)} title="2 horas"></span>
              <span class="wait" style:left={x(r.queued)} style:width={x(r.until - r.queued)}
              ></span>
              <span class="start" style:left={x(r.queued)}></span>
              <span class="end" style:left={x(r.until)}></span>
            </div>
            <p class="what">{r.words}</p>
          </li>
        {/each}
      </ol>
      <div class="ticks tnum" aria-hidden="true">
        {#each [0, 60, 120, 180] as m (m)}
          <span style:left={x(m)}>{hm(m)}</span>
        {/each}
      </div>
    </div>

    <p class="legend">
      <span class="dots" aria-hidden="true"></span> As 2 horas de cada comanda: depois daqui, ela não
      sai mais.
    </p>

    <p class="sum" aria-live="polite">{summary}.</p>

    {#if sample}
      <div class="late-sample">
        <p>O começo da comanda do #{lateOne?.n}, quando ela sai atrasada:</p>
        <div class="mini">
          <Paper lines={sample} paper={58} edge="top" />
        </div>
      </div>
    {/if}
  </div>
  <figcaption>
    Simulação com as regras de verdade: esperar, avisar depois de 10 minutos, desistir depois de 2
    horas, não imprimir pedido cancelado. Pedidos de exemplo.
  </figcaption>
</figure>

<style>
  figure.off {
    margin: 12px 0;
    display: grid;
    gap: 14px;
  }
  .panel {
    display: grid;
    gap: 18px;
    padding: 20px 18px 22px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }
  figure.off p {
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  figure.off p strong {
    color: var(--ink);
  }

  .ctl {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: 4px 12px;
  }
  .ctl label {
    font-weight: 600;
    color: var(--ink);
  }
  .ctl output {
    font: 600 1.75rem/1 var(--font-display);
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .ctl input {
    grid-column: 1 / -1;
    width: 100%;
    height: 44px;
    margin: 0;
    accent-color: var(--primary);
    cursor: pointer;
  }
  .ctl input:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .scale {
    grid-column: 1 / -1;
    display: flex;
    justify-content: space-between;
    margin-top: -8px;
    font-size: 0.75rem;
    color: var(--ink-muted);
  }

  .chart {
    position: relative;
    padding-bottom: 22px;
  }
  .dark {
    position: absolute;
    top: 0;
    bottom: 22px;
    left: 0;
    border-radius: 8px 0 0 8px;
    background: repeating-linear-gradient(-45deg, var(--hover) 0 6px, transparent 6px 12px);
    background-color: color-mix(in srgb, var(--ink) 5%, transparent);
  }
  .dark span {
    position: absolute;
    top: 6px;
    left: 8px;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    color: var(--ink-muted);
  }
  .back {
    position: absolute;
    top: 0;
    bottom: 16px;
    width: 2px;
    margin-left: -1px;
    background: var(--ink);
  }
  ol.rows {
    position: relative;
    display: grid;
    gap: 14px;
    margin: 0;
    padding: 30px 0 0;
    list-style: none;
  }
  ol.rows li.row {
    display: grid;
    gap: 6px;
    font-size: inherit;
  }
  figure.off .who {
    position: relative;
    font-size: 0.875rem;
    line-height: 1.3;
  }
  figure.off .what {
    font-size: 0.875rem;
    line-height: 1.35;
    color: var(--ink);
  }
  .row.expired .what,
  .row.cancelled .what {
    color: var(--danger);
  }
  .row.late .what {
    color: var(--warning);
  }
  .track {
    position: relative;
    height: 16px;
  }
  .track::before {
    content: '';
    position: absolute;
    top: 7px;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--line);
  }
  .limit {
    position: absolute;
    top: 1px;
    width: 0;
    height: 14px;
    border-left: 2px dotted var(--ink-muted);
  }
  .wait {
    position: absolute;
    top: 4px;
    height: 8px;
    border-radius: 4px;
    background: repeating-linear-gradient(90deg, var(--ink-muted) 0 4px, transparent 4px 7px);
  }
  .start {
    position: absolute;
    top: 3px;
    width: 10px;
    height: 10px;
    margin-left: -5px;
    border-radius: 50%;
    background: var(--ink);
  }
  /* the outcome: a ticket, a ticket with a notice, or a cross */
  .end {
    position: absolute;
    top: -2px;
    width: 14px;
    height: 20px;
    margin-left: -7px;
    border-radius: 2px;
    background: var(--success);
    mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 7px
      100%;
  }
  .row.late .end {
    background: var(--warning);
  }
  .expired .end,
  .cancelled .end {
    top: 1px;
    height: 14px;
    border-radius: 0;
    mask: none;
    background:
      linear-gradient(45deg, transparent 40%, var(--danger) 40% 60%, transparent 60%),
      linear-gradient(-45deg, transparent 40%, var(--danger) 40% 60%, transparent 60%);
  }
  .ticks {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 16px;
    font-size: 0.75rem;
    color: var(--ink-muted);
  }
  .ticks span {
    position: absolute;
    translate: -50% 0;
  }
  .ticks span:first-child {
    translate: 0 0;
  }
  figure.off .legend {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: -6px;
    font-size: 0.8125rem;
  }
  .dots {
    flex: none;
    height: 14px;
    border-left: 2px dotted var(--ink-muted);
  }
  figure.off .sum {
    font-weight: 600;
    color: var(--ink);
  }
  .late-sample {
    display: grid;
    gap: 10px;
    justify-items: start;
  }
  .mini {
    container-type: inline-size;
    width: min(100%, 300px);
    --w80: min(100cqi, 300px);
    filter: drop-shadow(0 4px 8px rgb(18 60 50 / 0.14));
  }
  figure.off figcaption {
    max-width: 46ch;
    margin-inline: auto;
  }

  @media (min-width: 560px) {
    .panel {
      padding: 24px 26px 26px;
    }
  }
</style>
