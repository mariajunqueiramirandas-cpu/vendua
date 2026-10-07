<script lang="ts">
  import { LIMITS, NAME, READABLE, requests, sameHost } from './platforms';

  // How many questions (GETs) the import asks each platform for a menu of this size, from each
  // adapter's `read`, against the caps in http.ts. Goomer has no "whole menu" answer for options,
  // so it asks once per product: that is why its screen says "alguns minutos".
  let products = $state(14);
  let categories = $state(4);

  const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const rows = $derived(
    READABLE.map((p) => {
      const n = requests(p, products, categories);
      const cap = p === 'goomer' ? LIMITS.goomer.requests : LIMITS.requests;
      const budget = (p === 'goomer' ? LIMITS.goomer.importMs : LIMITS.importMs) / 1000;
      const wait = (Math.max(0, sameHost(p, products, categories) - 1) * LIMITS.hostGapMs) / 1000;
      return { p, n, cap, over: n > cap || wait > budget };
    }),
  );
  const top = $derived(Math.max(20, ...rows.map((r) => r.n)) * 1.08);
  const goomer = $derived(rows.find((r) => r.p === 'goomer')!);
  const goomerWait = $derived(((products - 1) * LIMITS.hostGapMs) / 1000);
  const q = (n: number) => `${n} ${n === 1 ? 'pergunta' : 'perguntas'}`;
</script>

<figure class="pq">
  <div class="controls">
    <div class="ctl">
      <label for="pq-p">Produtos no cardápio</label>
      <output for="pq-p" class="tnum">{products}</output>
      <input
        id="pq-p"
        type="range"
        min="5"
        max="1000"
        step="1"
        bind:value={products}
        aria-valuetext="{products} produtos"
      />
    </div>
    <div class="ctl">
      <label for="pq-c">Categorias</label>
      <output for="pq-c" class="tnum">{categories}</output>
      <input
        id="pq-c"
        type="range"
        min="1"
        max="30"
        step="1"
        bind:value={categories}
        aria-valuetext="{categories} categorias"
      />
    </div>
  </div>

  <ul class="bars">
    {#each rows as r (r.p)}
      <li class:over={r.over}>
        <span class="name">{NAME[r.p]}</span>
        <span class="track" aria-hidden="true">
          <span class="fill" style="width: {Math.max(0.6, (r.n / top) * 100)}%"></span>
        </span>
        <span class="val tnum">
          {q(r.n)}{#if r.over}<span class="flag">, passa do teto</span>{/if}
        </span>
      </li>
    {/each}
  </ul>

  <p class="read" aria-live="polite">
    {#if goomer.over}
      Com {products} produtos, o Goomer passaria do teto dele: {LIMITS.goomer.requests} perguntas e
      {LIMITS.goomer.importMs / 1000} segundos. A tela avisa que o cardápio é grande demais para trazer
      de uma vez.
    {:else}
      Com {products} produtos, o Goomer leva pelo menos {nf.format(goomerWait)} s só nos intervalos de
      {LIMITS.hostGapMs} milésimos de segundo entre uma pergunta e a próxima. As outras seis cabem em
      poucos segundos.
    {/if}
  </p>

  <figcaption>
    Feito com as regras reais: cada barra conta as perguntas que a Venduá faz à plataforma para ler
    um cardápio desse tamanho (sem módulo de pizza). Teto por leitura: {LIMITS.requests} perguntas e
    {LIMITS.importMs / 1000} segundos; o Goomer tem {LIMITS.goomer.requests} e {LIMITS.goomer
      .importMs / 1000}.
  </figcaption>
</figure>

<style>
  figure.pq {
    margin: 12px 0;
    display: grid;
    gap: 16px;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-e1);
  }
  .controls {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px 20px;
  }
  .ctl {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: 2px 8px;
  }
  .ctl label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink);
  }
  output {
    font: 600 1.25rem/1 var(--font-display);
    color: var(--ink);
  }
  input[type='range'] {
    grid-column: 1 / -1;
    width: 100%;
    height: 44px;
    margin: 0;
    accent-color: var(--success);
    cursor: pointer;
  }

  figure.pq ul.bars {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure.pq .bars li {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr) 128px;
    gap: 10px;
    align-items: center;
    font-size: 0.875rem;
    line-height: 1.3;
    color: var(--ink);
  }
  .name {
    font-weight: 600;
  }
  .track {
    height: 16px;
    border-radius: 4px;
    background:
      repeating-linear-gradient(90deg, var(--line) 0 1px, transparent 1px 10%),
      var(--surface-sunken);
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: var(--success);
    transition: width var(--duration-smooth) var(--ease-soft);
  }
  .over .fill {
    background: repeating-linear-gradient(
      135deg,
      var(--danger) 0 6px,
      color-mix(in srgb, var(--danger) 70%, var(--surface)) 6px 10px
    );
  }
  .val {
    text-align: right;
    color: var(--ink-muted);
  }
  .flag {
    color: var(--danger);
    font-weight: 700;
  }
  figure.pq p.read {
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink);
  }
  figure.pq figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
  }
  @media (max-width: 520px) {
    figure.pq .bars li {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 4px 10px;
    }
    .track {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
</style>
