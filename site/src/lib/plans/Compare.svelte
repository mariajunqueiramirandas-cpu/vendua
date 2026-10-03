<script lang="ts">
  import { plans } from './live.svelte';

  const { mirim, bandeira, pangolim } = plans;
  const cols = [mirim, bandeira, pangolim];

  // true = included, false = not in that plan, a string = the value itself
  type Cell = boolean | string;
  type Row = { name: string; cells: [Cell, Cell, Cell]; note?: [string?, string?, string?] };
  const all: [Cell, Cell, Cell] = [true, true, true];
  const up: [Cell, Cell, Cell] = [false, true, true];
  const top: [Cell, Cell, Cell] = [false, false, true];

  const groups: { name: string; rows: Row[] }[] = $derived([
    {
      name: 'Loja e pedidos',
      rows: [
        'Loja online com o seu nome',
        'App de pedidos no celular',
        'Pix na sua conta do Mercado Pago',
        'Cardápio, estoque e encomendas',
        'Entrega e retirada',
        'Cupons e lista de espera',
        'Relatórios',
        'Equipe',
      ].map((name) => ({ name, cells: all })),
    },
    {
      name: 'Cozinha',
      rows: [
        { name: 'Tela da cozinha', cells: up },
        { name: 'Impressão automática da comanda', cells: up },
      ],
    },
    { name: 'Clientes', rows: [{ name: 'Cartão fidelidade', cells: up }] },
    {
      name: 'Duá, vendedor com IA no WhatsApp',
      rows: [
        {
          name: 'Conversas por mês',
          cells: [false, bandeira.conversations ?? false, pangolim.conversations ?? false],
          note: [
            undefined,
            bandeira.trial && bandeira.trialConversations
              ? `${bandeira.trialConversations} no teste`
              : undefined,
          ],
        },
      ],
    },
    {
      name: 'Marca',
      rows: [
        { name: 'Domínio próprio', cells: top },
        { name: 'Site feito pelo nosso agente de IA', cells: top },
      ],
    },
    {
      name: 'Para começar',
      rows: [
        { name: 'Taxa da Venduá por pedido', cells: ['nenhuma', 'nenhuma', 'nenhuma'] },
        {
          name: 'Teste antes de pagar',
          cells: cols.map((p) => (p.trial ? `${p.trial}, sem cartão` : false)) as [
            Cell,
            Cell,
            Cell,
          ],
        },
      ],
    },
  ]);
</script>

<details class="compare">
  <summary><span>Comparar os planos</span><i class="chev" aria-hidden="true"></i></summary>
  <div class="scroll">
    <table>
      <caption class="sr-only">O que vem em cada plano da Venduá</caption>
      <colgroup>
        <col />
        <col />
        <col class="rec" />
        <col />
      </colgroup>
      <thead>
        <tr>
          <td></td>
          {#each cols as p (p.id)}
            <th scope="col" class:rec={p.id === bandeira.id}>
              <span class="pn">{p.short}</span>
              <span class="pp tnum">{p.price}<small>/mês</small></span>
            </th>
          {/each}
        </tr>
      </thead>
      {#each groups as g (g.name)}
        <tbody>
          <tr class="group">
            <th scope="colgroup" colspan="4">{g.name}</th>
          </tr>
          {#each g.rows as r (r.name)}
            <tr>
              <th scope="row">{r.name}</th>
              {#each r.cells as c, i (i)}
                <td>
                  {#if c === true}
                    <i class="yes" aria-hidden="true"></i><span class="sr-only">incluso</span>
                  {:else if c === false}
                    <span class="no" aria-hidden="true">—</span><span class="sr-only"
                      >não inclui</span
                    >
                  {:else}
                    <span class="val tnum" class:long={c.length > 8}>{c}</span>
                  {/if}
                  {#if r.note?.[i]}<small class="note">{r.note[i]}</small>{/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      {/each}
    </table>
  </div>
</details>

<style>
  .compare {
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--line);
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 54px;
    padding: 0 22px;
    border-radius: var(--radius-lg);
    font: 600 1.0625rem/1.3 var(--font-display);
    letter-spacing: -0.01em;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    background: var(--hover);
  }
  .chev {
    flex: none;
    width: 10px;
    height: 10px;
    margin-top: -5px;
    border: solid currentColor;
    border-width: 0 2px 2px 0;
    border-radius: 1px;
    rotate: 45deg;
    transition: rotate var(--duration-smooth) var(--ease-soft);
  }
  [open] .chev {
    rotate: 225deg;
    margin-top: 5px;
  }

  .scroll {
    padding: 0 22px 22px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9375rem;
    line-height: 1.35;
  }
  col.rec {
    background: color-mix(in srgb, var(--spark) 26%, transparent);
  }
  th,
  td {
    padding: 10px 8px;
    text-align: center;
    vertical-align: middle;
  }
  thead th {
    width: 22%;
    padding-block: 14px 12px;
    border-bottom: 2px solid var(--line-strong);
    vertical-align: bottom;
  }
  thead th.rec {
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  }
  .pn {
    display: block;
    font: 600 1rem/1.2 var(--font-display);
    letter-spacing: -0.01em;
  }
  .pp {
    display: block;
    margin-top: 2px;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .pp small {
    font-size: inherit;
  }
  tbody th[scope='row'] {
    text-align: left;
    font-weight: 500;
    padding-left: 0;
  }
  tbody tr + tr > * {
    border-top: 1px solid var(--line);
  }
  .group th {
    padding: 22px 0 6px;
    text-align: left;
    font: 600 1rem/1.3 var(--font-display);
    letter-spacing: -0.01em;
    border-bottom: 1px solid var(--line-strong);
  }
  /* the column tint shouldn't run under the group titles */
  .group {
    background: var(--surface);
  }
  .yes {
    display: inline-block;
    width: 7px;
    height: 13px;
    margin-top: -3px;
    border: solid var(--success);
    border-width: 0 2.5px 2.5px 0;
    border-radius: 1px;
    rotate: 40deg;
    vertical-align: middle;
  }
  .no {
    color: var(--ink-faint);
  }
  .val {
    font-weight: 600;
  }
  .val.long {
    display: block;
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--success);
  }
  .note {
    display: block;
    font-size: 0.75rem;
    line-height: 1.25;
    color: var(--ink-muted);
  }

  @media (prefers-color-scheme: dark) {
    col.rec {
      background: color-mix(in srgb, var(--spark) 10%, transparent);
    }
  }
  @media (max-width: 559px) {
    .scroll {
      padding: 0 12px 16px;
    }
    summary {
      padding-inline: 18px;
    }
    table {
      font-size: 0.875rem;
      table-layout: fixed;
    }
    thead th {
      width: 66px;
    }
    th,
    td {
      padding: 9px 4px;
    }
    .pn {
      font-size: 0.875rem;
    }
    .pp {
      font-size: 0.75rem;
    }
    .pp small {
      display: block;
    }
  }
</style>
