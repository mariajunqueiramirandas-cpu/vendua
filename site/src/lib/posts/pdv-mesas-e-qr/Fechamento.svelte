<script lang="ts">
  import { brl } from './money';

  // Closing the caixa (apps/admin/src/features/pdv/Caixa.tsx, CaixaReport.tsx; ADR 0035): the
  // drawer's expected cash is the float plus cash taken plus suprimentos minus sangrias, the other
  // methods are the sums taken; the difference is counted minus expected, worded "conferido",
  // "faltou" or "sobrou". Attendants count blind: no expected amounts until the report.

  type Method = 'cash' | 'pix' | 'credit' | 'debit' | 'voucher';
  const LABEL: Record<Method, string> = {
    cash: 'Dinheiro',
    pix: 'Pix',
    credit: 'Crédito',
    debit: 'Débito',
    voucher: 'Vale-refeição',
  };
  const HINT: Record<Method, string> = {
    cash: 'Notas e moedas da gaveta, com o troco inicial.',
    pix: 'O que entrou no banco pelo Pix no balcão.',
    credit: 'O total de crédito no relatório da maquininha.',
    debit: 'O total de débito no relatório da maquininha.',
    voucher: 'O total de vale-refeição na maquininha.',
  };

  const opening = 15000;
  const cashTaken = 48650;
  const suprimento = { cents: 5000, reason: 'Mais troco' };
  const sangria = { cents: 30000, reason: 'Depósito no banco' };
  const expectedCash = opening + cashTaken + suprimento.cents - sangria.cents;

  const rows: { m: Method; expected: number; counted: number }[] = [
    { m: 'cash', expected: expectedCash, counted: 38450 },
    { m: 'pix', expected: 61200, counted: 61200 },
    { m: 'credit', expected: 24340, counted: 23840 },
    { m: 'debit', expected: 17490, counted: 17990 },
    { m: 'voucher', expected: 9600, counted: 9600 },
  ];
  // the chart shows the differences: a few reais either side of conferido
  const scale = Math.max(100, ...rows.map((r) => Math.abs(r.counted - r.expected)));
  const total = rows.reduce((n, r) => n + r.counted - r.expected, 0);

  const word = (d: number) =>
    d === 0 ? 'conferido' : d < 0 ? `faltou ${brl(-d)}` : `sobrou ${brl(d)}`;
  const tone = (d: number) => (d === 0 ? 'ok' : d < 0 ? 'short' : 'over');

  const uid = $props.id();
  let view = $state<'gerente' | 'atendente'>('gerente');
  const blind = $derived(view === 'atendente');
</script>

<figure class="caixa-w" aria-label="Exemplo de fechamento de caixa por forma de pagamento">
  <div class="card">
    <fieldset class="seg">
      <legend class="sr">Quem está contando</legend>
      <label>
        <input type="radio" name="{uid}-view" value="gerente" bind:group={view} />
        <span>contando como gerente</span>
      </label>
      <label>
        <input type="radio" name="{uid}-view" value="atendente" bind:group={view} />
        <span>contando como atendente</span>
      </label>
    </fieldset>

    <p class="lead" aria-live="polite">
      {blind
        ? 'Quem é atendente conta às cegas: digita o que tem em cada forma sem ver o esperado. As diferenças aparecem no fechamento.'
        : 'Quem é gerente vê o esperado de cada forma enquanto conta. O fechamento guarda a diferença.'}
    </p>

    <div class="drawer">
      <div class="flow-row">
        <div class="cell">
          <span class="k">Troco inicial</span><span class="v tnum">{brl(opening)}</span>
        </div>
        <span class="op" aria-hidden="true">+</span>
        <div class="cell">
          <span class="k">Dinheiro recebido</span><span class="v tnum"
            >{blind ? '—' : brl(cashTaken)}</span
          >
        </div>
        <span class="op" aria-hidden="true">+</span>
        <div class="cell">
          <span class="k">Suprimento</span><span class="v tnum">{brl(suprimento.cents)}</span>
          <span class="r">{suprimento.reason}</span>
        </div>
        <span class="op" aria-hidden="true">−</span>
        <div class="cell">
          <span class="k">Sangria</span><span class="v tnum">{brl(sangria.cents)}</span>
          <span class="r">{sangria.reason}</span>
        </div>
        <div class="cell result">
          <span class="k">Esperado na gaveta</span>
          <span class="v tnum">{blind ? '—' : brl(expectedCash)}</span>
        </div>
      </div>
    </div>

    <div class="chart">
      {#if !blind}
        <div class="axis" aria-hidden="true">
          <span class="tnum">faltou {brl(scale)}</span>
          <span>conferido</span>
          <span class="tnum">sobrou {brl(scale)}</span>
        </div>
      {/if}
      <ul class="rows" aria-label="diferença entre contado e esperado por forma">
        {#each rows as r (r.m)}
          {@const d = r.counted - r.expected}
          <li class="row">
            <div class="r-top">
              <span class="m">{LABEL[r.m]}</span>
              {#if blind}
                <span class="chip wait">aparece no fechamento</span>
              {:else}
                <span class="chip {tone(d)}">{word(d)}</span>
              {/if}
            </div>
            {#if !blind}
              <div class="track" aria-hidden="true">
                {#if d === 0}
                  <span class="zero"></span>
                {:else}
                  <span
                    class="bar {tone(d)}"
                    style="{d < 0 ? 'right' : 'left'}: 50%; width: {(Math.abs(d) / scale) * 50}%"
                  ></span>
                {/if}
              </div>
            {/if}
            <p class="nums tnum">
              <span>contado <strong>{brl(r.counted)}</strong></span>
              <span>
                esperado
                {#if blind}<strong title="o gerente vê os valores no fechamento">—</strong
                  >{:else}<strong>{brl(r.expected)}</strong>{/if}
              </span>
            </p>
            <p class="hint">{HINT[r.m]}</p>
          </li>
        {/each}
      </ul>
    </div>

    <div class="sum">
      <p>
        <strong>No total</strong>
        {#if blind}
          <span class="chip wait">aparece no fechamento</span>
        {:else}
          <span class="chip {tone(total)}">{word(total)}</span>
        {/if}
      </p>
      {#if !blind}
        <p class="story">
          O crédito faltou e o débito sobrou o mesmo valor: um cartão passado no débito e registrado
          como crédito. Os dois reais da gaveta ficam anotados no fechamento.
        </p>
      {/if}
    </div>
  </div>
  <figcaption>
    Um fechamento de exemplo da Bolos da Nena. A conta do esperado na gaveta e as palavras de cada
    diferença são as do caixa da Venduá.
  </figcaption>
</figure>

<style>
  figure.caixa-w {
    margin: 12px 0;
    display: grid;
    gap: 12px;
  }
  .card {
    display: grid;
    gap: 16px;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-e2);
  }
  figure.caixa-w p,
  figure.caixa-w li {
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }
  figure.caixa-w ul {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    margin: 0;
    padding: 4px;
    border: 0;
    border-radius: 999px;
    background: var(--surface-sunken);
  }
  .seg label {
    position: relative;
    display: grid;
  }
  .seg input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }
  .seg span {
    display: grid;
    place-items: center;
    min-height: 44px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    color: var(--ink-muted);
    pointer-events: none;
  }
  .seg input:checked + span {
    background: var(--primary);
    color: var(--on-primary);
  }
  .seg input:focus-visible + span {
    outline: 2px solid var(--spark);
    outline-offset: 2px;
    box-shadow: 0 0 0 6px #123c32;
  }
  figure.caixa-w .lead {
    color: var(--ink-muted);
  }

  /* the drawer's arithmetic, left to right */
  .drawer {
    padding: 12px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    border-top: 6px solid var(--line-strong);
  }
  .flow-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .cell {
    display: grid;
    flex: 1 1 6.5rem;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface);
  }
  .cell.result {
    flex-basis: 100%;
    background: var(--spark-soft);
  }
  .k {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .v {
    font: 600 1.0625rem/1.3 var(--font-display);
    color: var(--ink);
  }
  .result .v {
    font-size: 1.375rem;
  }
  .r {
    font-size: 0.75rem;
    color: var(--ink-muted);
  }
  .op {
    flex: none;
    width: 14px;
    text-align: center;
    font: 600 1.125rem/1 var(--font-display);
    color: var(--ink-muted);
  }

  figure.caixa-w .row {
    display: grid;
    gap: 6px;
  }
  .r-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 12px;
  }
  .m {
    font-weight: 650;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 0.8125rem;
    font-weight: 650;
    white-space: nowrap;
  }
  .chip.ok {
    background: var(--success-soft);
    color: var(--success);
  }
  .chip.short {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .chip.over {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .chip.wait {
    background: var(--surface-sunken);
    color: var(--ink-muted);
  }
  .axis {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .axis span:last-child {
    text-align: right;
  }
  figure.caixa-w .rows {
    gap: 14px;
  }
  .track {
    position: relative;
    height: 26px;
    border-radius: 6px;
    background:
      linear-gradient(var(--ink-muted), var(--ink-muted)) center / 2px 100% no-repeat,
      linear-gradient(90deg, var(--line) 1px, transparent 1px) 0 0 / 10% 100%,
      var(--surface-sunken);
  }
  .bar {
    position: absolute;
    top: 4px;
    bottom: 4px;
    min-width: 6px;
    transition: width var(--duration-smooth) var(--ease-soft);
  }
  .bar.short {
    border: 2px solid var(--danger);
    border-radius: 6px 0 0 6px;
    background: repeating-linear-gradient(-45deg, var(--danger) 0 3px, transparent 3px 7px);
  }
  .bar.over {
    border: 2px solid var(--warning);
    border-radius: 0 6px 6px 0;
    background: repeating-linear-gradient(-45deg, var(--warning) 0 3px, transparent 3px 7px);
  }
  .zero {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--success);
    translate: -50% -50%;
    rotate: 45deg;
  }
  figure.caixa-w .nums {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 16px;
    font-size: 0.875rem;
    color: var(--ink-muted);
  }
  .nums strong {
    color: var(--ink);
    font-weight: 650;
  }
  figure.caixa-w .hint {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }

  .sum {
    display: grid;
    gap: 8px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .sum p:first-child {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  figure.caixa-w .story {
    color: var(--ink-muted);
  }
  figure.caixa-w figcaption {
    max-width: none;
    text-align: left;
  }

  @media (prefers-reduced-motion: reduce) {
    .bar {
      transition: none;
    }
  }
</style>
