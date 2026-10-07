<script lang="ts">
  import { allergySegments, isWithout, type Mini } from './rules';

  // A small ticket for the bump-bar widget, after the admin's Ticket.tsx: the 1–9 key that picks it,
  // "sem" options in red with a stop sign, allergy words marked in the note, one big action.
  let {
    t,
    slot,
    selected,
    cursor,
    undoLeft,
  }: {
    t: Mini;
    slot: number;
    selected: boolean;
    cursor: number | null;
    /** seconds left to undo "pronto", while it waits */
    undoLeft: number | null;
  } = $props();

  const segs = $derived(allergySegments(t.note));
  const allergy = $derived(segs.some((s) => s.hit));
</script>

<article
  class="mt"
  class:selected
  aria-label="Pedido {t.number}, {t.name}, {t.state === 'confirmed'
    ? 'na fila'
    : 'preparando'}{t.rush ? ', prioridade' : ''}{selected ? ', selecionado' : ''}"
>
  <header>
    <span class="slot tnum" aria-hidden="true">{slot}</span>
    <p class="num tnum">#{t.number} <span>{t.name}</span></p>
  </header>
  <p class="tags">
    <span class="tag">{t.state === 'confirmed' ? 'na fila' : 'preparando'}</span>
    {#if t.rush}<span class="tag rush">prioridade</span>{/if}
    {#if allergy}<span class="tag alert">alergia</span>{/if}
  </p>
  <ul>
    {#each t.items as i, k (i.name)}
      <li class:done={i.done} class:cur={selected && cursor === k}>
        <span class="q tnum">{i.done ? '✓' : `${i.qty}×`}</span>
        <span class="n">
          {i.name}
          {#each i.mods as m (m)}
            {#if isWithout(m)}
              <span class="without">
                <svg viewBox="0 0 16 16" aria-hidden="true"
                  ><circle cx="8" cy="8" r="6" /><path d="M3.8 12.2 12.2 3.8" /></svg
                >{m}
              </span>
            {:else}
              <span class="mod">{m}</span>
            {/if}
          {/each}
        </span>
      </li>
    {/each}
  </ul>
  {#if t.note}
    <p class="note" class:alert={allergy}>
      {#each segs as s, k (k)}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}
    </p>
  {/if}
  <p class="act">{t.state === 'confirmed' ? 'começar' : 'pronto'}</p>
  {#if undoLeft !== null}
    <div class="veil">
      <p>#{t.number} pronto</p>
      <p class="undo tnum">desfazer (Z) {undoLeft}</p>
    </div>
  {/if}
</article>

<style>
  .mt {
    position: relative;
    display: grid;
    align-content: start;
    gap: 8px;
    padding: 12px;
    border-radius: 12px;
    background: var(--surface);
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-e1);
    overflow: hidden;
  }
  .mt.selected {
    box-shadow:
      0 0 0 3px var(--ink),
      var(--shadow-e1);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .slot {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background: var(--surface-sunken);
    box-shadow: inset 0 -2px 0 var(--line-strong);
    font: 700 0.875rem var(--font-display);
    color: var(--ink);
  }
  article.mt p {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--ink);
  }
  article p.num {
    font: 700 1.25rem/1.1 var(--font-display);
  }
  .num span {
    font: 600 0.875rem var(--font-sans);
    color: var(--ink-muted);
  }
  article p.tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tag {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-sunken);
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--ink-muted);
  }
  .tag.rush {
    background: var(--ink);
    color: var(--surface);
  }
  .tag.alert {
    background: var(--danger);
    color: var(--surface);
  }
  article.mt ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  article.mt ul li {
    display: flex;
    gap: 8px;
    padding: 6px 6px;
    border-radius: 6px;
    font-size: 0.875rem;
    line-height: 1.35;
    font-weight: 600;
    color: var(--ink);
  }
  article.mt li.cur {
    background: var(--spark-soft);
    box-shadow: inset 3px 0 0 var(--ink);
  }
  article.mt li.done {
    color: var(--ink-muted);
  }
  li.done .n {
    text-decoration: line-through;
  }
  .q {
    flex: none;
    min-width: 1.7em;
    font-family: var(--font-display);
    font-weight: 700;
  }
  li.done .q {
    color: var(--success);
  }
  .n {
    display: grid;
    gap: 2px;
  }
  .without {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 700;
    color: var(--danger);
  }
  li.done .without {
    color: var(--ink-muted);
  }
  .without svg {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .mod {
    font-weight: 500;
    color: var(--ink-muted);
  }
  article p.note {
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--warning-soft);
    font-weight: 600;
  }
  article p.note.alert {
    background: var(--danger-soft);
    box-shadow: inset 0 0 0 1px var(--danger);
  }
  mark {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--danger);
    color: var(--surface);
  }
  article p.act {
    display: grid;
    place-items: center;
    min-height: 40px;
    border-radius: 8px;
    background: var(--primary);
    color: var(--on-primary);
    font-weight: 700;
    font-size: 0.875rem;
  }
  .veil {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    gap: 6px;
    text-align: center;
    background: linear-gradient(var(--success-soft), var(--success-soft)), var(--surface);
  }
  .veil p {
    font: 700 1.125rem var(--font-display);
    color: var(--success);
  }
  .veil p.undo {
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--line-strong);
    font: 600 0.875rem var(--font-sans);
    color: var(--ink);
  }
</style>
