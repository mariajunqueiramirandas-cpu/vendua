<script lang="ts">
  import { MAX_ITEMS, MAX_TEXT, money, parseLines } from './paste';

  // "Colar lista" (Cardápio › colar lista in the admin): the same line rules as Core's
  // `parseMenuPaste`, run live in the page. Nothing is sent anywhere.
  const CATS = ['Bolos inteiros', 'Fatias do dia', 'Encomendas', 'Para acompanhar'];
  let text = $state(
    [
      '• Fatia de cenoura com brigadeiro - 9,00',
      'Fatia de chocolate: R$ 9,50',
      '3) Fatia de fubá com goiabada 8',
      'Fatia de milho cremoso | 8,50',
      'Fatia de laranja com calda - 8 reais',
      'Fatias quentinhas a partir das 15h!',
    ].join('\n'),
  );
  let cat = $state('Fatias do dia');

  const lines = $derived(parseLines(text));
  const items = $derived(lines.filter((l) => l.ok));
  const kept = $derived(items.slice(0, MAX_ITEMS));
  const skipped = $derived(lines.filter((l) => !l.ok));
</script>

<figure class="cl">
  <div class="in">
    <label for="cl-text">Lista</label>
    <p class="hint" id="cl-hint">
      Uma linha por produto, com o preço no fim. Ex.: “Pudim de leite - R$ 12,50”.
    </p>
    <textarea
      id="cl-text"
      rows="7"
      maxlength={MAX_TEXT}
      spellcheck="false"
      aria-describedby="cl-hint"
      bind:value={text}></textarea>
    <label for="cl-cat">Na categoria</label>
    <select id="cl-cat" bind:value={cat}>
      {#each CATS as c (c)}<option>{c}</option>{/each}
    </select>
  </div>

  <div class="slats" aria-hidden="true"></div>

  <div class="outp" aria-live="polite">
    {#if kept.length}
      <p class="lead">
        <strong>Vamos criar {kept.length} {kept.length === 1 ? 'produto' : 'produtos'}</strong> em {cat}:
      </p>
      <ul class="cards">
        {#each kept as it, i (i)}
          {#if it.ok}
            <li>
              <span class="nm">{it.name}</span>
              <span class="pr tnum">{money(it.priceCents)}</span>
              <span class="ct tnum">{it.priceCents} centavos</span>
            </li>
          {/if}
        {/each}
      </ul>
      {#if items.length > MAX_ITEMS}
        <p class="note">Entram os {MAX_ITEMS} primeiros de cada vez. Cole o resto depois.</p>
      {/if}
    {:else if text.trim()}
      <p class="lead">Ainda não achamos linhas com nome e preço.</p>
    {:else}
      <p class="lead">Cole a lista acima.</p>
    {/if}
    {#if skipped.length}
      <div class="leftout">
        <p>Ficam de fora, sem nome e preço no fim:</p>
        <ul>
          {#each skipped.slice(0, 4) as s, i (i)}<li>{s.raw}</li>{/each}
        </ul>
      </div>
    {/if}
  </div>

  <figcaption>
    Feito com as regras reais da Venduá para colar lista: o mesmo jeito de ler cada linha e de
    transformar o preço em centavos. Aqui nada é gravado; mude o texto à vontade.
  </figcaption>
</figure>

<style>
  figure.cl {
    margin: 12px 0;
    display: grid;
    gap: 14px;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-e1);
  }
  .in {
    display: grid;
    gap: 6px;
  }
  figure.cl label {
    font: 600 0.9375rem/1.3 var(--font-display);
    color: var(--ink);
  }
  figure.cl p.hint {
    margin-bottom: 2px;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  textarea,
  select {
    width: 100%;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--line-strong);
    background: var(--surface-sunken);
    color: var(--ink);
    font: 500 1rem/1.55 var(--font-sans);
  }
  textarea {
    padding: 10px 12px;
    resize: vertical;
    min-height: 180px;
  }
  select {
    min-height: 48px;
    padding: 0 12px;
  }
  textarea:focus-visible,
  select:focus-visible {
    border-color: var(--ink);
  }
  figure.cl label[for='cl-cat'] {
    margin-top: 8px;
  }

  .slats {
    height: 14px;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    background:
      repeating-linear-gradient(90deg, var(--line-strong) 0 3px, transparent 3px 12px),
      var(--surface-sunken);
  }

  .outp {
    display: grid;
    gap: 10px;
  }
  figure.cl p.lead {
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }
  figure.cl ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px;
  }
  figure.cl .cards li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 10px;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    background: var(--spark-soft);
    font-size: 0.9375rem;
    line-height: 1.35;
    color: var(--ink);
  }
  .nm {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .pr {
    font-weight: 700;
    white-space: nowrap;
  }
  .ct {
    grid-column: 1 / -1;
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  figure.cl p.note {
    font-size: 0.875rem;
    color: var(--ink-muted);
  }
  .leftout {
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    border: 1.5px dashed var(--line-strong);
  }
  figure.cl .leftout p,
  figure.cl .leftout li {
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }
  figure.cl .leftout li {
    color: var(--ink);
    text-decoration: line-through;
    text-decoration-color: var(--ink-muted);
  }
  figure.cl figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
  }
</style>
