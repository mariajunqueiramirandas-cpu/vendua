<script lang="ts">
  import Placa from './Placa.svelte';
  import { bagNote, DAY, money } from './rules';

  // What a shopper can do in each state of the store, from the Kernel's own gates: AddToCart is off
  // only while paused, takesOrders() lets a closed store take a bag made only of encomendas when
  // "Encomendas com a loja fechada" is on, and the paused banner is the one the shopper can't close
  // (Core's notices.ts: blocking, not dismissible).
  type Cell = 'sim' | 'não' | 'só encomendas';

  let preorders = $state(true);

  const COLS = [
    { id: 'open', name: 'Aberta', sign: 'Aberto', tag: null },
    { id: 'busy', name: 'Muitos pedidos', sign: 'Aberto', tag: 'Muitos pedidos agora' },
    { id: 'paused', name: 'Pausada', sign: 'Pausado', tag: null },
    { id: 'closed', name: 'Fechada', sign: 'Fechado', tag: null },
  ] as const;

  const rows = $derived<{ what: string; cells: Cell[] }[]>([
    { what: 'Ver o cardápio e os avisos', cells: ['sim', 'sim', 'sim', 'sim'] },
    { what: 'Pôr produtos na sacola', cells: ['sim', 'sim', 'não', 'sim'] },
    { what: 'Fazer um pedido para agora', cells: ['sim', 'sim', 'não', 'não'] },
    {
      what: 'Fazer uma encomenda',
      cells: ['sim', 'sim', 'não', preorders ? 'só encomendas' : 'não'],
    },
    { what: 'Fechar o aviso do topo', cells: ['sim', 'sim', 'não', 'sim'] },
    { what: 'Acompanhar o pedido já feito', cells: ['sim', 'sim', 'sim', 'sim'] },
  ]);

  // Saturday 19:00, after Nena's 18h close: she opens Sunday at 8h
  const NOW = 6 * DAY + 19 * 60;
  const OPENS = 7 * DAY + 8 * 60;
</script>

<figure class="estados">
  <div class="scroll">
    <table>
      <caption class="sr">O que o cliente consegue fazer em cada estado da loja</caption>
      <thead>
        <tr>
          <td></td>
          {#each COLS as c (c.id)}
            <th scope="col">
              <span class="head">
                <Placa word={c.sign} tag={c.tag} size="xs" />
                <span class="cname">{c.name}</span>
              </span>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.what)}
          <tr>
            <th scope="row">{r.what}</th>
            {#each r.cells as v, i (i)}
              <td class:changed={i === 3 && r.what === 'Fazer uma encomenda'}>
                <span class="mark {v === 'sim' ? 'yes' : v === 'não' ? 'no' : 'part'}">
                  <span class="shape" aria-hidden="true"></span>
                  <span class="word">{v}</span>
                </span>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="pre">
    <label class="switch">
      <input type="checkbox" bind:checked={preorders} />
      <span class="knob" aria-hidden="true"></span>
      <span class="sw">
        <strong>Encomendas com a loja fechada</strong>
        <span class="desc">
          {preorders
            ? 'Fora do horário, só entram pedidos feitos apenas de encomendas.'
            : 'Fora do horário, a loja não recebe pedidos, nem de encomenda.'}
        </span>
      </span>
    </label>
    <div class="bag" aria-live="polite">
      <p class="bagtitle">
        Sábado, 19h, sacola com uma fatia de cenoura ({money(900)}) e um bolo de aniversário 2 kg,
        que é encomenda ({money(16000)}):
      </p>
      <p class="note">{bagNote(OPENS, NOW, preorders)}</p>
    </div>
  </div>

  <figcaption>
    Feito com as regras reais da loja. A sacola fechada é um exemplo com produtos da Bolos da Nena.
  </figcaption>
</figure>

<style>
  figure.estados {
    display: grid;
    gap: 18px;
    margin: 12px 0;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .scroll {
    min-width: 0;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
  }
  thead td {
    width: 28%;
  }
  th,
  td {
    padding: 8px 3px;
    vertical-align: middle;
  }
  thead th {
    vertical-align: top;
    padding-bottom: 12px;
  }
  .head {
    display: grid;
    justify-items: center;
    gap: 8px;
  }
  .cname {
    font-size: 0.8125rem;
    line-height: 1.2;
    font-weight: 650;
    color: var(--ink);
    text-align: center;
  }
  tbody th {
    text-align: left;
    font-size: 0.875rem;
    line-height: 1.3;
    font-weight: 600;
    color: var(--ink);
    padding-right: 8px;
  }
  tbody tr + tr > * {
    border-top: 1px solid var(--line);
  }
  tbody td {
    text-align: center;
  }
  .mark {
    display: inline-grid;
    justify-items: center;
    gap: 3px;
    max-width: 100%;
    min-width: 0;
  }
  .shape {
    position: relative;
    width: 22px;
    height: 22px;
    border-radius: 50%;
  }
  .yes .shape {
    background: var(--success);
  }
  .yes .shape::after {
    content: '';
    position: absolute;
    left: 7px;
    top: 4px;
    width: 6px;
    height: 10px;
    border: solid var(--surface);
    border-width: 0 2.5px 2.5px 0;
    transform: rotate(45deg);
  }
  .no .shape {
    border: 2px solid var(--ink-muted);
    background:
      linear-gradient(45deg, transparent 45%, var(--ink-muted) 45% 55%, transparent 55%),
      linear-gradient(-45deg, transparent 45%, var(--ink-muted) 45% 55%, transparent 55%);
    background-size: 60% 60%;
    background-position: center;
    background-repeat: no-repeat;
  }
  .part .shape {
    background: linear-gradient(90deg, var(--warning) 50%, var(--warning-soft) 50%);
    box-shadow: inset 0 0 0 2px var(--warning);
  }
  .word {
    max-width: 100%;
    overflow-wrap: anywhere;
    hyphens: auto;
    font-size: 0.75rem;
    line-height: 1.15;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .yes .word {
    color: var(--ink);
  }
  td.changed {
    background: color-mix(in srgb, var(--warning-soft) 70%, transparent);
    border-radius: 10px;
  }

  .pre {
    display: grid;
    gap: 12px;
    padding: 16px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }
  .switch {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-height: 44px;
    cursor: pointer;
  }
  .switch input {
    position: absolute;
    opacity: 0;
    width: 44px;
    height: 28px;
    margin: 0;
    cursor: pointer;
  }
  .knob {
    flex: none;
    position: relative;
    width: 44px;
    height: 26px;
    margin-top: 2px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1.5px var(--ink-muted);
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .knob::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--ink-muted);
    box-shadow: var(--shadow-e1);
    transition: transform var(--duration-quick) var(--ease-soft);
  }
  .switch input:checked + .knob {
    background: var(--primary);
  }
  .switch input:checked + .knob::after {
    transform: translateX(18px);
    background: var(--on-primary);
  }
  .switch input:focus-visible + .knob {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .knob,
    .knob::after {
      transition: none;
    }
  }
  .sw {
    display: grid;
    gap: 2px;
    font-size: 0.9375rem;
    line-height: 1.4;
    color: var(--ink);
  }
  .desc {
    color: var(--ink-muted);
    font-size: 0.875rem;
  }
  .bag {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--surface);
  }
  figure.estados p.bagtitle,
  figure.estados p.note {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.45;
  }
  figure.estados p.bagtitle {
    color: var(--ink-muted);
  }
  figure.estados p.note {
    padding-left: 10px;
    border-left: 3px solid var(--ink-muted);
    color: var(--ink);
    font-weight: 600;
  }
  figure.estados figcaption {
    max-width: none;
  }
  @media (max-width: 480px) {
    thead td {
      width: 24%;
    }
    tbody th {
      font-size: 0.8125rem;
    }
    .cname {
      font-size: 0.75rem;
    }
  }
</style>
