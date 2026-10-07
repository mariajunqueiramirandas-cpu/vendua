<script lang="ts">
  import { onMount } from 'svelte';
  import { actionFor, atStation, type StationItem } from './rules';

  // Stations are a filter on the menu's categories (routes-kitchen.ts: a category goes to one station
  // only; model.ts: an item whose category no station claims shows on every screen, "Tudo" shows
  // everything). The same order on three devices, recomputed with the real rule.
  const stations = [
    { id: 'confeitaria', name: 'Confeitaria' },
    { id: 'copa', name: 'Copa' },
  ];
  const categories = [
    { id: 'bolos', name: 'Bolos inteiros' },
    { id: 'fatias', name: 'Fatias' },
    { id: 'bebidas', name: 'Bebidas' },
  ];
  const claim = $state<Record<string, string | null>>({
    bolos: 'confeitaria',
    fatias: null,
    bebidas: 'copa',
  });
  const lines = $state([
    { id: 'a', qty: 1, name: 'Bolo de aniversário 2 kg', cat: 'bolos', done: false },
    { id: 'b', qty: 3, name: 'Fatia de cenoura com brigadeiro', cat: 'fatias', done: false },
    { id: 'c', qty: 2, name: 'Suco de laranja 400 ml', cat: 'bebidas', done: false },
    { id: 'd', qty: 1, name: 'Café coado 300 ml', cat: 'bebidas', done: false },
  ]);
  let live = $state(false);
  onMount(() => (live = true));

  const items = $derived<StationItem[]>(
    lines.map((l) => ({ ...l, stationId: claim[l.cat] ?? null })),
  );
  const screens = [...stations, { id: 'all', name: 'Tudo (expedição)' }];
  const nameOf = (id: string | null) => stations.find((s) => s.id === id)?.name ?? '';

  function view(s: string) {
    const mine = items.filter((i) => atStation(i.stationId, s));
    const others = items.filter((i) => !atStation(i.stationId, s));
    const where = [...new Set(others.map((i) => nameOf(i.stationId)))].join(' e ');
    const done = others.filter((i) => i.done).length;
    return { mine, others, where, done, action: actionFor(items, s) };
  }
  const toggle = (id: string) => {
    const l = lines.find((x) => x.id === id);
    if (l) l.done = !l.done;
  };
</script>

<figure class="st-w" aria-label="Estações da cozinha pelas categorias do cardápio">
  <fieldset class="cats">
    <legend>Cada categoria do cardápio vai para uma estação</legend>
    {#each categories as c (c.id)}
      <div class="cat">
        <span class="cname" id="cat-{c.id}">{c.name}</span>
        <div class="seg" role="radiogroup" aria-labelledby="cat-{c.id}">
          {#each [...stations, { id: null, name: 'nenhuma' }] as s (s.id ?? 'none')}
            <button
              type="button"
              role="radio"
              aria-checked={claim[c.id] === s.id}
              disabled={!live}
              onclick={() => (claim[c.id] = s.id)}>{s.name}</button
            >
          {/each}
        </div>
      </div>
    {/each}
  </fieldset>

  <div class="screens">
    {#each screens as s (s.id)}
      {@const v = view(s.id)}
      <section class="dev" aria-label="Tela da estação {s.name}">
        <p class="bar">{s.name}</p>
        <div class="tk">
          <p class="tnum num">#29 <span>Luiz</span></p>
          {#if v.mine.length}
            <ul>
              {#each v.mine as i (i.id)}
                <li>
                  <button
                    type="button"
                    class="it"
                    class:done={i.done}
                    aria-pressed={i.done}
                    disabled={!live}
                    onclick={() => toggle(i.id)}
                  >
                    <span class="q tnum">{i.done ? '✓' : `${i.qty}×`}</span>
                    <span class="n">
                      {i.name}
                      {#if i.stationId === null && s.id !== 'all'}
                        <em class="every">sem estação, aparece em todas</em>
                      {/if}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="none">Nada deste pedido é desta estação.</p>
          {/if}
          {#if v.others.length}
            <p class="others tnum">
              +{v.others.length}
              {v.others.length === 1 ? 'item' : 'itens'} em {v.where},
              {v.done === v.others.length
                ? 'tudo feito'
                : `${v.done} ${v.done === 1 ? 'feito' : 'feitos'}`}
            </p>
          {/if}
          <p class="act" class:wait={v.action === 'sua parte está pronta'}>{v.action}</p>
        </div>
      </section>
    {/each}
  </div>

  <figcaption>
    Simulação com a Bolos da Nena, feita com as regras reais das estações. Troque as categorias de
    lugar e toque nos itens: as marcas valem para todas as telas.
  </figcaption>
</figure>

<style>
  figure.st-w {
    display: grid;
    gap: 18px;
    margin: 12px 0;
    padding: 20px 14px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }
  .cats {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  legend {
    margin-bottom: 8px;
    padding: 0;
    font: 600 1rem/1.4 var(--font-display);
    color: var(--ink);
  }
  .cat {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 12px;
  }
  .cname {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
  }
  .seg {
    display: flex;
    padding: 3px;
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--line);
  }
  .seg button {
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--ink-muted);
    font: 600 0.875rem var(--font-sans);
    cursor: pointer;
  }
  .seg button[aria-checked='true'] {
    background: var(--primary);
    color: var(--on-primary);
  }
  .seg button:disabled,
  .it:disabled {
    cursor: default;
  }
  .seg button:focus-visible,
  .it:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .screens {
    display: grid;
    gap: 12px;
  }
  .dev {
    display: grid;
    grid-template-rows: auto 1fr;
    padding: 5px;
    border-radius: 14px;
    background: var(--bezel);
  }
  figure p.bar {
    margin: 0;
    padding: 6px 10px;
    font: 600 0.875rem/1.3 var(--font-display);
    color: var(--after-ink);
  }
  .tk {
    display: grid;
    align-content: start;
    gap: 8px;
    padding: 12px;
    border-radius: 10px;
    background: var(--surface);
  }
  figure .tk p {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  figure .tk p.num {
    font: 700 1.25rem/1.1 var(--font-display);
    color: var(--ink);
  }
  .num span {
    font: 600 0.875rem var(--font-sans);
    color: var(--ink-muted);
  }
  figure .tk ul {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure .tk li {
    font-size: 0.875rem;
    line-height: 1.35;
  }
  .it {
    display: flex;
    gap: 8px;
    width: 100%;
    min-height: 44px;
    padding: 6px 8px;
    border: 0;
    border-radius: 8px;
    background: var(--surface-sunken);
    color: var(--ink);
    text-align: left;
    font: 600 0.875rem/1.35 var(--font-sans);
    cursor: pointer;
  }
  .it.done {
    color: var(--ink-muted);
  }
  .it.done .n {
    text-decoration: line-through;
  }
  .q {
    flex: none;
    min-width: 1.8em;
    font-family: var(--font-display);
    font-weight: 700;
  }
  .it.done .q {
    color: var(--success);
  }
  .n {
    display: grid;
    gap: 2px;
  }
  .every {
    font-style: normal;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--info);
  }
  figure .tk p.act {
    display: grid;
    place-items: center;
    min-height: 40px;
    margin-top: 2px;
    border-radius: 8px;
    background: var(--primary);
    color: var(--on-primary);
    font-weight: 700;
    font-size: 0.875rem;
  }
  figure .tk p.act.wait {
    background: var(--surface-sunken);
    color: var(--ink-muted);
  }

  figure.st-w figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
  }

  @media (min-width: 600px) {
    figure.st-w {
      padding: 26px 24px 22px;
    }
    .screens {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
  }
</style>
