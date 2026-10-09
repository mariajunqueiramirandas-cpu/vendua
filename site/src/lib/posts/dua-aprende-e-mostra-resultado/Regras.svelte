<script lang="ts">
  import { compileRule, describeGuard, KINDS } from './regras';

  // The rule sheet from Ensinar, with Core's own compiler: a rule it recognizes becomes "sempre
  // cumprida", anything else is guidance (apps/admin/src/features/vendedor/Teach.sheet.tsx).
  const SAMPLES = [
    'Não aceite dinheiro acima de R$ 200',
    'Acima de R$ 300, só Pix',
    'Não dê cupom em pedido abaixo de R$ 60',
    'Encomenda acima de R$ 400, me chama',
    'Mais de 10 unidades do mesmo bolo, passa para mim',
    'Sempre ofereça vela para bolo de aniversário',
    'Não prometa entrega antes das 14h',
  ];

  let text = $state(SAMPLES[0]!);
  const words = $derived(text.trim());
  const guard = $derived(words.length >= 3 ? compileRule(words) : null);
</script>

<figure class="regras" aria-labelledby="regras-cap">
  <div class="sheet">
    <label for="regra" class="lbl">A regra, com as suas palavras</label>
    <textarea id="regra" rows="2" maxlength="500" bind:value={text}></textarea>
    <div class="samples" role="group" aria-label="Experimente uma regra pronta">
      {#each SAMPLES as s (s)}
        <button type="button" aria-pressed={text === s} onclick={() => (text = s)}>{s}</button>
      {/each}
    </div>

    <div class="verdict" aria-live="polite">
      <p class="how">Como fica</p>
      {#if words.length < 3}
        <p class="txt">Escreva a regra para ver como o Duá vai tratar.</p>
      {:else if guard}
        <span class="chip sure">
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6Z" /><path
              class="tick"
              d="m8.5 12 2.5 2.5 4.5-5"
            /></svg
          >
          sempre cumprida
        </span>
        <p class="txt">{describeGuard(guard)}</p>
      {:else}
        <span class="chip guide">
          <svg viewBox="0 0 24 24" aria-hidden="true"
            ><circle cx="12" cy="12" r="9" /><path class="needle" d="m15.5 8.5-2 5-5 2 2-5Z" /></svg
          >
          o Duá segue como orientação
        </span>
        <p class="txt">
          O Duá segue como uma instrução para a equipe. Para ser sempre cumprida, fale de valor ou
          quantidade, como "não aceite dinheiro acima de R$ 200".
        </p>
      {/if}
    </div>

    <div class="kinds">
      <p class="how">O que o sistema sabe cumprir sozinho</p>
      <ul>
        {#each KINDS as k (k.kind)}
          <li class:hit={guard?.kind === k.kind}>
            <span class="box" aria-hidden="true"></span>
            {k.label}{#if guard?.kind === k.kind}<span class="sr">: é esta</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
  </div>
  <figcaption id="regras-cap">
    Feito com as regras reais do Duá: a mesma leitura que o app faz enquanto você escreve.
  </figcaption>
</figure>

<style>
  .regras {
    margin: 16px 0;
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .sheet {
    display: grid;
    gap: 14px;
    padding: 20px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow:
      var(--shadow-e1),
      inset 0 0 0 1px var(--line);
  }
  @media (min-width: 560px) {
    .sheet {
      padding: 24px 26px;
    }
  }
  .lbl {
    font-size: 0.9375rem;
    font-weight: 650;
    color: var(--ink);
  }
  textarea {
    width: 100%;
    min-height: 76px;
    padding: 12px 14px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--ink);
    font: 500 1.0625rem/1.5 var(--font-sans);
    resize: vertical;
  }
  textarea:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .samples {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .samples button {
    min-height: 44px;
    padding: 8px 14px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 500 0.875rem/1.3 var(--font-sans);
    text-align: left;
    cursor: pointer;
  }
  .samples button:hover {
    background: var(--hover);
  }
  .samples button[aria-pressed='true'] {
    border-color: var(--ink);
    background: var(--press);
  }
  .samples button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .verdict {
    display: grid;
    justify-items: start;
    gap: 8px;
    min-height: 140px;
    align-content: start;
    padding: 14px 16px;
    border-radius: var(--radius-md);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  figure.regras p {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink);
  }
  figure.regras p.how {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    padding: 0 12px 0 9px;
    border-radius: 999px;
    font-size: 0.875rem;
    font-weight: 650;
  }
  .chip svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .sure {
    background: var(--success-soft);
    color: var(--success);
  }
  .guide {
    background: var(--surface-sunken);
    color: var(--ink-muted);
  }
  .kinds {
    display: grid;
    gap: 8px;
  }
  figure.regras ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure.regras li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 4px 10px;
    border-radius: 8px;
    font-size: 0.9375rem;
    line-height: 1.35;
    color: var(--ink-muted);
  }
  .box {
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: 5px;
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
  }
  figure.regras li.hit {
    background: var(--success-soft);
    color: var(--ink);
    font-weight: 600;
  }
  li.hit .box {
    background: var(--success);
    box-shadow: none;
    position: relative;
  }
  li.hit .box::after {
    content: '';
    position: absolute;
    left: 5px;
    top: 2px;
    width: 4px;
    height: 8px;
    border: solid var(--surface);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  figure.regras figcaption {
    max-width: none;
    text-align: left;
  }
</style>
