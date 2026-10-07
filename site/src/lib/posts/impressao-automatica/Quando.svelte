<script lang="ts">
  import { height, renderTicket, type Order } from './ticket';

  // "Quando imprimir" (apps/admin/src/features/printers/Printers.tsx WhenSection) on three orders
  // of one evening, one of them refused. On "Ao aceitar o pedido" Core queues the ticket when the
  // store accepts; on "Assim que chega", when the order is placed (packages/core/src/modules/
  // printing/jobs.ts enqueueOrderPrintTx). Each strip is as long as that order's real layout.

  const pickup = (n: number, customer: string, items: [number, string][]): Order => ({
    number: n,
    customer,
    mode: 'pickup',
    placed: '',
    items: items.map(([qty, name]) => ({ qty, name, unitCents: 0, choices: [] })),
    feeCents: 0,
    payment: 'Pix',
    paymentLine: 'PAGO',
  });

  const EVENING = [
    {
      order: pickup(30, 'Bia', [
        [2, 'Fatia de cenoura com brigadeiro'],
        [1, 'Café coado 300 ml'],
      ]),
      arrives: 2,
      decided: 4,
      accepted: true,
    },
    {
      order: pickup(31, 'Caio', [
        [1, 'Bolo de aniversário 2 kg'],
        [4, 'Suco de laranja 400 ml'],
        [2, 'Fatia de fubá com goiabada'],
      ]),
      arrives: 9,
      decided: 11,
      accepted: false,
    },
    {
      order: pickup(32, 'Rafa', [
        [1, 'Bolo de milho cremoso'],
        [1, 'Bolo de chocolate molhadinho'],
      ]),
      arrives: 17,
      decided: 18,
      accepted: true,
    },
  ].map((e) => ({ ...e, lines: height(renderTicket(e.order, { paper: 80, codepage: 'cp850' })) }));

  const SPAN = 25; // 18:00 to 18:25
  const at = (m: number) => `${(m / SPAN) * 100}%`;
  const clock = (m: number) => `18:${String(m).padStart(2, '0')}`;

  const LANES = [
    {
      id: 'confirmed',
      name: 'Ao aceitar o pedido',
      printsAt: (e: (typeof EVENING)[number]) => (e.accepted ? e.decided : null),
    },
    {
      id: 'placed',
      name: 'Assim que chega',
      printsAt: (e: (typeof EVENING)[number]) => e.arrives,
    },
  ].map((l) => {
    const printed = EVENING.filter((e) => l.printsAt(e) !== null);
    const wasted = printed.filter((e) => !e.accepted);
    return {
      ...l,
      printed: printed.length,
      longest: Math.max(...printed.map((e) => e.lines)),
      wasted: wasted.length,
      lines: printed.reduce((n, e) => n + e.lines, 0),
      wastedLines: wasted.reduce((n, e) => n + e.lines, 0),
    };
  });
  const most = Math.max(...LANES.map((l) => l.lines));
</script>

<figure class="qd" aria-label="Comparação entre as duas opções de Quando imprimir">
  <div class="panel">
    {#each LANES as lane (lane.id)}
      <div class="lane">
        <p class="lane-name">
          <strong>{lane.name}</strong>
          {#if lane.id === 'confirmed'}<span class="def">o padrão</span>{/if}
        </p>
        <div
          class="track"
          aria-hidden="true"
          style:--most={lane.longest}
          style:--extra={lane.wasted ? 32 : 0}
        >
          <span class="axis"></span>
          {#each EVENING as e (e.order.number)}
            {@const p = lane.printsAt(e)}
            <span class="arrive" style:left={at(e.arrives)}>
              <span class="num tnum">#{e.order.number}</span>
            </span>
            {#if p !== null}
              <span class="strip" class:waste={!e.accepted} style:left={at(p)} style:--len={e.lines}
              ></span>
              {#if !e.accepted}
                <span class="tag bad" style:left={at(p)} style:--len={e.lines}
                  >recusado, papel no lixo</span
                >
              {/if}
            {:else}
              <span class="refused" style:left={at(e.decided)}></span>
              <span class="tag" style:left={at(e.decided)}>recusado, nada impresso</span>
            {/if}
          {/each}
        </div>
        <div class="ticks tnum" aria-hidden="true">
          {#each [0, 5, 10, 15, 20, 25] as m (m)}
            <span style:left={at(m)}>{clock(m)}</span>
          {/each}
        </div>
        <p class="sum">
          {lane.printed} comandas,
          {lane.wasted === 0 ? 'nenhuma no lixo' : `${lane.wasted} no lixo`}.
          {lane.id === 'confirmed'
            ? 'A cozinha vê o pedido quando você aceita.'
            : 'A cozinha vê o pedido no instante em que ele chega.'}
        </p>
      </div>
    {/each}

    <div class="bars">
      <p class="bars-title"><strong>Papel gasto</strong> em linhas impressas, papel de 80 mm</p>
      {#each LANES as lane (lane.id)}
        <div class="bar-row">
          <span class="bar-name">{lane.name}</span>
          <span class="bar" style:--w={lane.lines / most}>
            <span class="used" style:--u={(lane.lines - lane.wastedLines) / lane.lines}></span>
          </span>
          <span class="bar-val tnum">
            {lane.lines} linhas{lane.wastedLines ? `, ${lane.wastedLines} no lixo` : ''}
          </span>
        </div>
      {/each}
    </div>
  </div>
  <figcaption>
    Exemplo com três pedidos de uma noite na Bolos da Nena. Cada comanda tem o tamanho que teria de
    verdade, linha por linha.
  </figcaption>
</figure>

<style>
  figure.qd {
    margin: 12px 0;
    display: grid;
    gap: 14px;
  }
  .panel {
    display: grid;
    gap: 22px;
    padding: 20px 18px 22px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }
  figure.qd p {
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  figure.qd p strong {
    color: var(--ink);
    font-weight: 650;
  }
  .lane {
    display: grid;
    gap: 10px;
  }
  figure.qd .lane-name {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    font-size: 1rem;
  }
  .lane-name strong {
    font-family: var(--font-display);
  }
  .def {
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--spark-soft);
    color: var(--ink);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .track {
    --u: 3px;
    position: relative;
    height: calc(max(var(--u) * var(--most) + 36px, 72px) + var(--extra) * 1px);
    margin-inline: 14px;
  }
  .axis {
    position: absolute;
    top: 22px;
    left: -14px;
    right: -14px;
    height: 2px;
    border-radius: 1px;
    background: var(--line-strong);
  }
  .arrive {
    position: absolute;
    top: 17px;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: inset 0 0 0 2.5px var(--ink);
  }
  .num {
    position: absolute;
    bottom: 15px;
    left: 50%;
    translate: -50% 0;
    font: 600 0.8125rem/1 var(--font-display);
    color: var(--ink);
  }
  /* a ticket hanging from the moment it printed */
  .strip {
    position: absolute;
    top: 28px;
    width: 26px;
    height: calc(var(--len) * var(--u));
    margin-left: -13px;
    background:
      repeating-linear-gradient(
          180deg,
          transparent 0 5px,
          color-mix(in srgb, var(--sky-6) 34%, transparent) 5px 6.5px
        )
        50% 6px / 62% calc(100% - 12px) no-repeat,
      var(--surface);
    box-shadow:
      0 0 0 1px var(--line-strong),
      0 3px 6px rgb(18 60 50 / 0.12);
    mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 6px
      100%;
  }
  .strip.waste {
    background:
      linear-gradient(
        to top right,
        transparent calc(50% - 1.5px),
        var(--danger) calc(50% - 1.5px) calc(50% + 1.5px),
        transparent calc(50% + 1.5px)
      ),
      repeating-linear-gradient(
          180deg,
          transparent 0 5px,
          color-mix(in srgb, var(--sky-6) 34%, transparent) 5px 6.5px
        )
        50% 6px / 62% calc(100% - 12px) no-repeat,
      var(--danger-soft);
  }
  .refused {
    position: absolute;
    top: 16px;
    width: 14px;
    height: 14px;
    margin-left: -7px;
    background:
      linear-gradient(45deg, transparent 42%, var(--danger) 42% 58%, transparent 58%),
      linear-gradient(-45deg, transparent 42%, var(--danger) 42% 58%, transparent 58%);
  }
  .tag {
    position: absolute;
    top: 34px;
    max-width: 8.5em;
    margin-left: -4.25em;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.25;
    text-align: center;
    color: var(--ink-muted);
  }
  .tag.bad {
    top: calc(34px + var(--len) * var(--u));
    color: var(--danger);
  }
  .ticks {
    position: relative;
    height: 18px;
    margin: 0 14px;
    font-size: 0.75rem;
    color: var(--ink-muted);
  }
  .ticks span {
    position: absolute;
    translate: -50% 0;
  }
  .ticks span:first-child {
    translate: -14px 0;
  }
  .ticks span:last-child {
    translate: calc(-100% + 14px) 0;
  }
  .bars {
    display: grid;
    gap: 10px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .bar-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .bar-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink);
  }
  .bar {
    display: block;
    width: calc(var(--w) * 100%);
    height: 14px;
    border-radius: 3px;
    background: var(--danger);
    overflow: hidden;
  }
  .used {
    display: block;
    width: calc(var(--u) * 100%);
    height: 100%;
    background: var(--ink);
  }
  .bar-val {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  figure.qd figcaption {
    max-width: 46ch;
    margin-inline: auto;
  }

  @media (min-width: 560px) {
    .panel {
      padding: 24px 26px 26px;
    }
    .bar-row {
      grid-template-columns: 9.5rem 1fr;
      column-gap: 14px;
      align-items: center;
    }
    .bar-val {
      grid-column: 2;
    }
  }

  @media (prefers-color-scheme: dark) {
    .strip {
      background:
        repeating-linear-gradient(
            180deg,
            transparent 0 5px,
            color-mix(in srgb, var(--sky-6) 40%, transparent) 5px 6.5px
          )
          50% 6px / 62% calc(100% - 12px) no-repeat,
        color-mix(in srgb, var(--after-ink) 88%, var(--sky-5));
    }
    .strip.waste {
      background:
        linear-gradient(
          to top right,
          transparent calc(50% - 1.5px),
          var(--danger) calc(50% - 1.5px) calc(50% + 1.5px),
          transparent calc(50% + 1.5px)
        ),
        repeating-linear-gradient(
            180deg,
            transparent 0 5px,
            color-mix(in srgb, var(--sky-6) 40%, transparent) 5px 6.5px
          )
          50% 6px / 62% calc(100% - 12px) no-repeat,
        color-mix(in srgb, var(--after-ink) 70%, var(--danger));
    }
  }
</style>
