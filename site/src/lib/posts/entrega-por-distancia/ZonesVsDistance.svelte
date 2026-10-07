<script lang="ts">
  import { DOORS, brl, km1, quote, roadKm, type Pt } from './model';
  import { sim } from './state.svelte';

  // Same street, two prices: a flat fee per bairro (example values) against the distance rule with
  // the simulator's knobs. Fee before the cart's threshold.
  const rows: { name: string; where: string; bairro: string; bairroCents: number; at: Pt }[] = [
    {
      name: 'Duda',
      where: 'começo da Vila Nova',
      bairro: 'Vila Nova',
      bairroCents: 1000,
      at: { x: 3.9, y: 6.4 },
    },
    {
      name: 'Caio',
      where: 'fim da Vila Nova',
      bairro: 'Vila Nova',
      bairroCents: 1000,
      at: DOORS[1]!.at,
    },
    {
      name: 'Rita',
      where: 'Beira-Rio, do outro lado',
      bairro: 'Beira-Rio',
      bairroCents: 900,
      at: DOORS[2]!.at,
    },
  ];
  const priced = $derived(rows.map((r) => ({ ...r, q: quote(sim.knobs, roadKm(r.at), 0) })));
</script>

<figure class="w" aria-label="Taxa por bairro comparada com a taxa por distância">
  <table>
    <thead>
      <tr>
        <th scope="col">Porta</th>
        <th scope="col">Por bairro</th>
        <th scope="col">Por distância</th>
      </tr>
    </thead>
    <tbody>
      {#each priced as r (r.name)}
        <tr>
          <th scope="row">
            <strong>{r.name}</strong>
            <span>{r.where}</span>
          </th>
          <td>
            <strong class="tnum">{brl(r.bairroCents)}</strong>
            <span>tabela da {r.bairro}</span>
          </td>
          <td>
            {#if r.q.ok}
              <strong class="tnum">{brl(r.q.fee)}</strong>
              <span class="tnum">{km1(r.q.km)} km pelo caminho</span>
            {:else}
              <strong class="out">fora da área</strong>
              <span class="tnum">{km1(r.q.km)} km pelo caminho</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <figcaption>
    Exemplo com a Bolos da Nena: as taxas por bairro são inventadas para comparar; a coluna da
    distância usa os valores do simulador.
  </figcaption>
</figure>

<style>
  figure.w {
    display: grid;
    gap: 12px;
    margin: 12px 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9375rem;
    line-height: 1.35;
    color: var(--ink);
  }
  th,
  td {
    padding: 10px 8px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--line);
  }
  th:first-child {
    padding-left: 0;
  }
  thead th {
    font: 600 0.8125rem/1.3 var(--font-sans);
    color: var(--ink-muted);
    border-bottom: 2px solid var(--line-strong);
  }
  tbody th {
    font-weight: 400;
  }
  table strong {
    display: block;
    font: 600 1rem/1.3 var(--font-display);
    color: var(--ink);
  }
  table span {
    display: block;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  table strong.out {
    color: var(--danger);
  }
  td:last-child {
    background: color-mix(in srgb, var(--spark) 22%, transparent);
  }
  thead th:last-child {
    background: color-mix(in srgb, var(--spark) 22%, transparent);
    color: var(--ink);
  }
  figure.w figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
</style>
