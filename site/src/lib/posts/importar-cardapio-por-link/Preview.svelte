<script lang="ts">
  import { money } from './paste';
  import { COUNTS, HIDDEN_LINES, MENU, NOTE_LINES, SECTIONS, SOURCE } from './nena';

  // The end of the belt: the admin's import preview (ImportFlow.tsx `Preview`, then `Done`), drawn
  // in code with the same words. Nothing is "imported" until "Essa loja é minha" is on.
  let {
    done = false,
    photos = 0,
    onimport,
  }: { done?: boolean; photos?: number; onimport?: () => void } = $props();

  let mine = $state(false);
  let picked = $state<Record<string, boolean>>(
    Object.fromEntries(SECTIONS.map((s) => [s.id, true])),
  );
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

{#if !done}
  <div class="pv">
    <div class="card">
      <div class="found-head">
        <span class="ok" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" /></svg>
        </span>
        <div>
          <p class="big">
            Encontramos {COUNTS.products} produtos em {COUNTS.categories} categorias
          </p>
          <p class="muted">no {SOURCE}, na loja Bolos da Nena</p>
        </div>
      </div>
      <ul class="found">
        <li>{COUNTS.photos} fotos</li>
        <li>{COUNTS.optionGroups} grupos de opções</li>
        <li>horários: 6 dias por semana</li>
        <li>retirada e entrega</li>
        <li>3 formas de pagamento e Pix</li>
        <li>logo e capa da loja</li>
      </ul>
      <div class="notice" role="note">
        <svg viewBox="0 0 24 24" aria-hidden="true"
          ><path
            d="M3 12s3.5-6 9-6c1.6 0 3 .5 4.2 1.2M21 12s-3.5 6-9 6c-1.6 0-3-.5-4.2-1.2M4 20L20 4"
          /></svg
        >
        <div>
          <p class="strong">
            {plural(COUNTS.hidden, 'produto vem oculto', 'produtos vêm ocultos')}
          </p>
          <p>
            O preço deles podia sair diferente do {SOURCE}, então chegam escondidos para você
            conferir e mostrar. Veja o porquê lá embaixo.
          </p>
        </div>
      </div>
    </div>

    <p class="h">O cardápio</p>
    <div class="cats">
      {#each MENU as cat, i (cat.name)}
        <details open={i === 2}>
          <summary>
            <span class="cat">{cat.name}</span>
            <span class="muted">{plural(cat.products.length, 'produto', 'produtos')}</span>
          </summary>
          <ul class="prods">
            {#each cat.products as p (p.name)}
              <li>
                <span class="thumb" aria-hidden="true"></span>
                <span class="name">
                  <span>{p.name}</span>
                  {#if p.note}<span class="muted small">{p.note}</span>{/if}
                </span>
                <span class="price">
                  <span class="tnum">{money(p.cents)}</span>
                  {#if p.hidden}<span class="badge">oculto</span>{/if}
                </span>
              </li>
            {/each}
          </ul>
        </details>
      {/each}
    </div>

    <p class="h">O que mais trazer</p>
    <p class="muted lead">Já vem marcado. Desmarque o que preferir preencher do zero.</p>
    <div class="card list">
      {#each SECTIONS as s (s.id)}
        <label class="row">
          <span class="txt">
            <span class="strong">{s.label}</span>
            <span class="muted small">{s.summary}</span>
          </span>
          <input type="checkbox" role="switch" bind:checked={picked[s.id]} />
        </label>
      {/each}
    </div>

    <p class="h">O que não vem igual</p>
    <div class="card lost">
      <p class="strong">Vêm ocultos, para você conferir</p>
      <ul>
        {#each HIDDEN_LINES as l (l)}<li>{l}</li>{/each}
      </ul>
      <p class="strong">Não vem do jeito que estava</p>
      <ul>
        {#each NOTE_LINES as l (l)}<li>{l}</li>{/each}
      </ul>
    </div>

    <div class="card gate">
      <label class="row">
        <span class="txt">
          <span class="strong">Essa loja é minha</span>
          <span class="muted small">Só importe o cardápio da sua própria loja no {SOURCE}.</span>
        </span>
        <input type="checkbox" role="switch" bind:checked={mine} />
      </label>
      <button type="button" class="go" disabled={!mine || !onimport} onclick={() => onimport?.()}>
        Importar {COUNTS.products} produtos
      </button>
    </div>
  </div>
{:else}
  <div class="pv">
    <div class="card done">
      <img src="/dua/sucesso.webp" alt="" width="96" height="96" />
      <p class="big">Pronto! {COUNTS.products} produtos no seu cardápio</p>
      <p class="muted">
        {plural(COUNTS.hidden, 'ficou oculto', 'ficaram ocultos')} para você conferir.
      </p>
    </div>
    <div class="card photos">
      <p class="strong row-tight">
        <span>{photos >= COUNTS.photos ? 'Fotos prontas' : 'Trazendo as fotos'}</span>
        <span class="tnum muted small">{photos} de {COUNTS.photos}</span>
      </p>
      <span
        class="bar"
        role="progressbar"
        aria-label="fotos"
        aria-valuemin={0}
        aria-valuemax={COUNTS.photos}
        aria-valuenow={photos}
      >
        <span style="width: {(photos / COUNTS.photos) * 100}%"></span>
      </span>
      {#if photos < COUNTS.photos}
        <p class="muted small">Pode seguir: as fotos continuam chegando sozinhas.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .pv {
    display: grid;
    gap: 10px;
    width: 100%;
    text-align: left;
  }
  .card {
    display: grid;
    gap: 12px;
    padding: 16px;
    border-radius: var(--radius-md);
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .pv p {
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }
  .pv p.muted,
  .pv .muted {
    color: var(--ink-muted);
  }
  .pv .small,
  .pv p.small {
    font-size: 0.8125rem;
    line-height: 1.35;
  }
  .pv p.big {
    font: 600 1.125rem/1.3 var(--font-display);
    letter-spacing: -0.01em;
  }
  .pv .strong,
  .pv p.strong {
    font-weight: 650;
  }
  .pv p.h {
    margin-top: 10px;
    padding-inline: 4px;
    font: 600 1.0625rem/1.3 var(--font-display);
  }
  .pv p.lead {
    margin-top: -6px;
    padding-inline: 4px;
  }
  .found-head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .ok {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--success-soft);
  }
  .ok svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: var(--success);
    stroke-width: 2.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  div.pv ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .found {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 6px;
  }
  .pv .found li {
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    font-size: 0.875rem;
    line-height: 1.35;
    color: var(--ink);
  }
  .notice {
    display: flex;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--warning-soft);
  }
  .notice svg {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    margin-top: 2px;
    fill: none;
    stroke: var(--warning);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .notice p {
    font-size: 0.875rem;
  }

  .cats {
    display: grid;
    gap: 6px;
  }
  details {
    border-radius: var(--radius-md);
    background: var(--surface);
    border: 1px solid var(--line);
  }
  summary {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
    min-height: 48px;
    padding: 8px 16px;
    cursor: pointer;
    font-size: 0.9375rem;
    list-style-position: inside;
  }
  summary::marker {
    color: var(--ink-muted);
  }
  .cat {
    flex: 1;
    font-weight: 650;
    color: var(--ink);
  }
  summary .muted {
    font-size: 0.8125rem;
  }
  .prods {
    border-top: 1px solid var(--line);
  }
  .pv .prods li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    border-top: 1px solid var(--line);
    font-size: 0.875rem;
    line-height: 1.35;
    color: var(--ink);
  }
  .pv .prods li:first-child {
    border-top: 0;
  }
  .thumb {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 8px;
    background:
      radial-gradient(circle at 50% 62%, var(--warning-soft) 0 34%, transparent 35%),
      var(--surface-sunken);
  }
  .name {
    flex: 1;
    min-width: 0;
    display: grid;
    font-weight: 600;
  }
  .price {
    display: grid;
    justify-items: end;
    font-weight: 650;
  }
  .badge {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--warning);
  }

  .list {
    gap: 0;
    padding-block: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding-block: 8px;
    cursor: pointer;
  }
  .list .row + .row {
    border-top: 1px solid var(--line);
  }
  .txt {
    flex: 1;
    min-width: 0;
    display: grid;
    font-size: 0.9375rem;
    line-height: 1.4;
    color: var(--ink);
  }
  input[role='switch'] {
    appearance: none;
    position: relative;
    width: 46px;
    height: 28px;
    flex-shrink: 0;
    margin: 8px 0;
    border-radius: 999px;
    background: var(--line-strong);
    cursor: pointer;
    transition: background var(--duration-quick) var(--ease-soft);
  }
  input[role='switch']::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
    transition: transform var(--duration-quick) var(--ease-soft);
  }
  input[role='switch']:checked {
    background: var(--success);
  }
  input[role='switch']:checked::after {
    transform: translateX(18px);
  }

  .lost {
    gap: 6px;
  }
  .pv .lost ul {
    display: grid;
    gap: 4px;
    margin-bottom: 8px;
    padding-left: 1.2em;
    list-style: disc;
  }
  .pv .lost li {
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink);
  }
  .pv .lost li::marker {
    color: var(--ink-muted);
  }

  .gate {
    background: var(--spark-soft);
    border-color: transparent;
  }
  .go {
    min-height: 52px;
    border: 0;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font: 650 1rem/1 var(--font-sans);
    cursor: pointer;
  }
  .go:disabled {
    background: var(--line-strong);
    color: var(--ink-muted);
    cursor: not-allowed;
  }

  .done {
    justify-items: center;
    text-align: center;
    gap: 6px;
    padding-block: 22px;
  }
  .done img {
    width: 96px;
    height: 96px;
  }
  .row-tight {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .bar {
    display: block;
    height: 8px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--line-strong);
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--success);
    transition: width var(--duration-smooth) var(--ease-soft);
  }
  @media (prefers-reduced-motion: reduce) {
    .bar span,
    input[role='switch'],
    input[role='switch']::after {
      transition: none;
    }
  }
</style>
