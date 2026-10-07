<script lang="ts">
  import { NAME, READABLE, SAMPLES, readableNames, recognise, type Verdict } from './platforms';

  // Paste or pick a link: the box answers with Core's own matching rules (platforms.ts mirrors
  // adapters/index.ts `recognise`) and the admin's words for each answer (copy.ts).
  let url = $state(SAMPLES[0]!.url);
  const v: Verdict = $derived(recognise(url));
  const lit = $derived(v.kind === 'ok' || v.kind === 'blocked' ? v.platform : null);
</script>

<figure class="lc">
  <div class="head">
    <label for="lc-url">Link do seu cardápio</label>
    <div class="field">
      <svg viewBox="0 0 24 24" aria-hidden="true" class="ico">
        <path
          d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
        />
      </svg>
      <input
        id="lc-url"
        type="text"
        inputmode="url"
        autocapitalize="none"
        autocomplete="off"
        spellcheck="false"
        maxlength="500"
        placeholder="Link da sua loja"
        bind:value={url}
      />
    </div>
    <p class="try" id="lc-try">Ou experimente um destes:</p>
    <div class="samples" role="group" aria-labelledby="lc-try">
      {#each SAMPLES as s (s.url)}
        <button
          type="button"
          class="chip"
          aria-pressed={url === s.url}
          onclick={() => (url = s.url)}>{s.label}</button
        >
      {/each}
    </div>
  </div>

  <div class="verdict {v.kind}" aria-live="polite">
    {#if v.kind === 'ok'}
      <span class="mark yes" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" /></svg>
      </span>
      <div>
        <p class="say"><strong>A Venduá lê.</strong> É uma loja no {NAME[v.platform]}: {v.ref}.</p>
        <p class="sub">
          {v.platform === 'goomer'
            ? 'O Goomer mostra um produto de cada vez: pode levar alguns minutos.'
            : 'Leva alguns segundos.'} Nada muda na sua loja até você tocar em “Importar”.
        </p>
      </div>
    {:else if v.kind === 'blocked'}
      <span class="mark no" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M7 12h10" /></svg>
      </span>
      <div>
        <p class="say"><strong>Esse a Venduá não lê.</strong></p>
        <p class="sub">
          A página do {NAME[v.platform]} não abre o cardápio para quem lê de fora, e a Venduá não força
          a porta. O caminho é <a href="#lista">colar a lista de produtos</a>: uma linha por
          produto, com o preço no fim.
        </p>
      </div>
    {:else if v.kind === 'custom'}
      <span class="mark maybe" aria-hidden="true">
        <svg viewBox="0 0 24 24"
          ><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17.5v.01" /></svg
        >
      </span>
      <div>
        <p class="say"><strong>Endereço próprio: a Venduá descobre na hora.</strong></p>
        <p class="sub">
          Ela confere se {v.host} aponta para o Goomer, pergunta ao OlaClick e ao Saipos se a loja é deles,
          e olha a página uma vez para reconhecer Cardápio Web e Delivery Direto. Se ninguém reconhecer,
          ela pede o link da loja na plataforma.
        </p>
      </div>
    {:else if v.kind === 'unsupported'}
      <span class="mark maybe" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 7v6M12 16.5v.01" /></svg>
      </span>
      <div>
        <p class="say"><strong>Esse link não parece de um cardápio que a gente lê.</strong></p>
        <p class="sub">
          Por enquanto, do {readableNames()}: cole o link da loja como aparece no navegador.
        </p>
      </div>
    {:else if v.kind === 'invalid'}
      <span class="mark maybe" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 7v6M12 16.5v.01" /></svg>
      </span>
      <div>
        <p class="say">
          <strong>Cole o link inteiro da sua loja, como aparece no navegador.</strong>
        </p>
      </div>
    {:else}
      <span class="mark maybe" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /></svg
        >
      </span>
      <div>
        <p class="say">
          <strong>Abra a sua loja no celular e copie o link da barra de endereço.</strong>
        </p>
      </div>
    {/if}
  </div>

  <ul class="rail" aria-label="Plataformas de cardápio">
    {#each READABLE as p (p)}
      <li class:on={lit === p}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" /></svg>
        {NAME[p]}<span class="sr">, a Venduá lê</span>
      </li>
    {/each}
    {#each ['anotaai', 'ifood'] as const as p (p)}
      <li class="off" class:on={lit === p}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12h10" /></svg>
        {NAME[p]}<span class="sr">, a Venduá não lê</span>
      </li>
    {/each}
  </ul>

  <figcaption>
    Feito com as regras reais: o mesmo jeito de reconhecer o link que a Venduá usa ao importar. A
    Bolos da Nena é uma loja de exemplo, e os links acima não levam a lugar nenhum.
  </figcaption>
</figure>

<style>
  figure.lc {
    margin: 12px 0;
    display: grid;
    gap: 14px;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-e1);
    border: 1px solid var(--line);
  }
  .head {
    display: grid;
    gap: 8px;
  }
  figure.lc label {
    font: 600 0.9375rem/1.3 var(--font-display);
    color: var(--ink);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 14px;
    border-radius: 999px;
    background: var(--surface-sunken);
    border: 1.5px solid var(--line-strong);
  }
  .field:focus-within {
    border-color: var(--ink);
  }
  .ico {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    fill: none;
    stroke: var(--ink-muted);
    stroke-width: 2;
    stroke-linecap: round;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 48px;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: 500 1rem/1 var(--font-sans);
  }
  input:focus {
    outline: none;
  }
  input::placeholder {
    color: var(--ink-muted);
  }
  figure.lc p.try {
    margin-top: 4px;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .samples {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    min-height: 44px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    background: transparent;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
  }
  .chip:hover {
    background: var(--hover);
  }
  .chip[aria-pressed='true'] {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--on-primary);
  }

  .verdict {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 14px 16px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    min-height: 92px;
  }
  .verdict.ok {
    background: var(--success-soft);
  }
  .verdict.blocked {
    background: var(--warning-soft);
  }
  .mark {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--ink-muted);
  }
  .mark.yes {
    background: var(--success);
  }
  .mark.no {
    border-radius: 8px;
    background: var(--warning);
  }
  .mark svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--surface);
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  figure.lc .verdict p {
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  figure.lc .verdict p.sub {
    margin-top: 2px;
    color: color-mix(in srgb, var(--ink) 75%, var(--ink-muted));
  }

  figure.lc ul.rail {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure.lc .rail li {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px 4px 6px;
    border-radius: 8px;
    font-size: 0.8125rem;
    line-height: 1.3;
    font-weight: 600;
    color: var(--ink-muted);
    background: var(--surface-sunken);
  }
  .rail svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--success);
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .rail li.off svg {
    stroke: var(--warning);
  }
  figure.lc .rail li.on {
    color: var(--ink);
    background: var(--spark-soft);
    box-shadow: inset 0 0 0 1.5px var(--ink);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  figure.lc figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
  }
</style>
