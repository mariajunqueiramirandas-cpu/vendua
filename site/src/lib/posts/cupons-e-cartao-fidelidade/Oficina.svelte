<script lang="ts">
  import Gates from './Gates.svelte';
  import Ticket from './Ticket.svelte';
  import {
    brl,
    CODE_RE,
    cleanCode,
    discountOf,
    FEE,
    gates,
    kindWords,
    MENU,
    type CouponDraft,
    type Kind,
    type Shopper,
  } from './rules';

  // The coupon workshop: the admin's "Novo cupom" sheet on one side, a sample bag on the other, and
  // Core's own checks and arithmetic (rules.ts) deciding whether the coupon applies and how much.

  let code = $state('DOMINGO');
  let kind = $state<Kind>('percent');
  let pct = $state(15);
  let fixed = $state(1000);
  let min = $state(5000);
  let first = $state(false);
  let once = $state(true);
  let until = $state(true);
  let limit = $state(false);
  let active = $state(true);

  let qty = $state<Record<string, number>>({ chocolate: 1, cenoura: 2, fatia: 1 });
  let mode = $state<'entrega' | 'retirada'>('entrega');
  let shopper = $state<Shopper>('new');
  let late = $state(false);
  let used = $state(12);

  const LIMIT = 50;

  const subtotal = $derived(MENU.reduce((t, m) => t + m.cents * (qty[m.id] ?? 0), 0));
  const fee = $derived(mode === 'entrega' ? FEE : 0);
  const draft: CouponDraft = $derived({
    kind,
    value: kind === 'percent' ? pct : kind === 'fixed' ? fixed : 0,
    minSubtotalCents: min,
    active,
    expired: until && late,
    maxRedemptions: limit ? LIMIT : null,
    usedTotal: used,
    oncePerPhone: once,
    firstOrderOnly: first,
  });
  const list = $derived(gates(draft, subtotal, shopper));
  const stop = $derived(list.find((g) => g.state === 'stop') ?? null);
  const d = $derived(stop ? null : discountOf(draft, subtotal, fee));
  const discount = $derived(d?.cents ?? 0);
  const total = $derived(subtotal + fee - discount);
  const words = $derived(kindWords(kind, draft.value));
  const codeOk = $derived(CODE_RE.test(code));

  const lines = $derived(
    [
      min ? `mínimo ${brl(min)}` : null,
      first ? 'só no 1º pedido' : null,
      once ? 'uma vez por cliente' : null,
      until ? 'vale até domingo' : null,
      limit ? `${LIMIT} usos` : null,
    ].filter((l): l is string => !!l),
  );
  const offWord = $derived(
    !stop ? null : stop.id === 'min' ? `Faltam ${brl(min - subtotal)}` : 'Não vale nesta sacola',
  );

  const KINDS: { value: Kind; label: string }[] = [
    { value: 'percent', label: '% de desconto' },
    { value: 'fixed', label: 'Valor fixo' },
    { value: 'free_delivery', label: 'Zera a entrega' },
  ];
  const SHOPPERS: { value: Shopper; label: string }[] = [
    { value: 'new', label: 'Primeira vez na loja' },
    { value: 'returning', label: 'Já pediu antes' },
    { value: 'used', label: 'Já usou este cupom' },
  ];

  const step = (id: string, by: number) =>
    (qty = { ...qty, [id]: Math.max(0, Math.min(9, (qty[id] ?? 0) + by)) });
</script>

<figure class="oficina" aria-labelledby="oficina-cap">
  <div class="preview">
    <Ticket big={words.big} small={words.small} {code} {lines} off={offWord} />
  </div>

  <div class="panes">
    <fieldset class="pane">
      <legend>O cupom</legend>

      <div class="field">
        <label for="of-code">Código</label>
        <input
          id="of-code"
          class="code-in"
          autocapitalize="characters"
          autocomplete="off"
          maxlength="32"
          value={code}
          aria-describedby="of-code-help"
          aria-invalid={!codeOk}
          oninput={(e) => {
            code = cleanCode(e.currentTarget.value);
            e.currentTarget.value = code;
          }}
        />
        <p id="of-code-help" class="help" class:bad={!codeOk}>
          {codeOk ? 'O que o cliente digita.' : 'Use de 3 a 32 letras ou números.'}
        </p>
      </div>

      <div class="chips" role="radiogroup" aria-label="Tipo de desconto">
        {#each KINDS as k (k.value)}
          <label class="chip">
            <input type="radio" name="of-kind" value={k.value} bind:group={kind} />
            <span>{k.label}</span>
          </label>
        {/each}
      </div>

      {#if kind === 'percent'}
        <div class="field">
          <label for="of-pct">Desconto <output class="val">{pct}%</output></label>
          <input
            id="of-pct"
            type="range"
            min="1"
            max="100"
            bind:value={pct}
            aria-valuetext="{pct}%"
          />
        </div>
      {:else if kind === 'fixed'}
        <div class="field">
          <label for="of-fixed">Desconto <output class="val">{brl(fixed)}</output></label>
          <input
            id="of-fixed"
            type="range"
            min="100"
            max="8000"
            step="100"
            bind:value={fixed}
            aria-valuetext={brl(fixed)}
          />
        </div>
      {/if}

      <div class="field">
        <label for="of-min">
          Pedido mínimo <output class="val">{min ? brl(min) : 'nenhum'}</output>
        </label>
        <input
          id="of-min"
          type="range"
          min="0"
          max="15000"
          step="500"
          bind:value={min}
          aria-valuetext={min ? brl(min) : 'nenhum'}
        />
      </div>

      <div class="toggles">
        <label class="tog"
          ><input type="checkbox" bind:checked={first} /> Só no primeiro pedido</label
        >
        <label class="tog"><input type="checkbox" bind:checked={once} /> Uma vez por cliente</label>
        <label class="tog"><input type="checkbox" bind:checked={until} /> Vale até domingo</label>
        <label class="tog"
          ><input type="checkbox" bind:checked={limit} /> Limitar a {LIMIT} usos</label
        >
        <label class="tog"><input type="checkbox" bind:checked={active} /> Cupom ligado</label>
      </div>
    </fieldset>

    <fieldset class="pane">
      <legend>A sacola de exemplo</legend>
      <ul class="items">
        {#each MENU as m (m.id)}
          <li>
            <span class="item">
              <span class="name">{m.name}</span>
              <span class="price">{brl(m.cents)}</span>
            </span>
            <span class="stepper">
              <button
                type="button"
                aria-label="Tirar um: {m.name}"
                disabled={(qty[m.id] ?? 0) === 0}
                onclick={() => step(m.id, -1)}>−</button
              >
              <output aria-label="Quantidade de {m.name}">{qty[m.id]}</output>
              <button
                type="button"
                aria-label="Pôr mais um: {m.name}"
                disabled={(qty[m.id] ?? 0) === 9}
                onclick={() => step(m.id, 1)}>+</button
              >
            </span>
          </li>
        {/each}
      </ul>

      <div class="chips" role="radiogroup" aria-label="Como o cliente recebe">
        <label class="chip">
          <input type="radio" name="of-mode" value="entrega" bind:group={mode} />
          <span>Entrega, {brl(FEE)}</span>
        </label>
        <label class="chip">
          <input type="radio" name="of-mode" value="retirada" bind:group={mode} />
          <span>Retirada</span>
        </label>
      </div>

      <div class="chips stack" role="radiogroup" aria-label="Quem está pedindo">
        {#each SHOPPERS as s (s.value)}
          <label class="chip">
            <input type="radio" name="of-shopper" value={s.value} bind:group={shopper} />
            <span>{s.label}</span>
          </label>
        {/each}
      </div>

      {#if until}
        <div class="chips" role="radiogroup" aria-label="Quando o pedido chega">
          <label class="chip">
            <input type="radio" name="of-day" value={false} bind:group={late} />
            <span>Pede no sábado</span>
          </label>
          <label class="chip">
            <input type="radio" name="of-day" value={true} bind:group={late} />
            <span>Pede na segunda</span>
          </label>
        </div>
      {/if}
      {#if limit}
        <div class="chips" role="radiogroup" aria-label="Usos até agora">
          <label class="chip">
            <input type="radio" name="of-used" value={12} bind:group={used} />
            <span>12 usos até agora</span>
          </label>
          <label class="chip">
            <input type="radio" name="of-used" value={LIMIT} bind:group={used} />
            <span>{LIMIT} usos até agora</span>
          </label>
        </div>
      {/if}
    </fieldset>
  </div>

  <div class="result" aria-live="polite">
    <div class="receipt">
      <dl>
        <div>
          <dt>Itens</dt>
          <dd>{brl(subtotal)}</dd>
        </div>
        <div>
          <dt>Entrega</dt>
          <dd>{fee ? brl(fee) : 'retirada'}</dd>
        </div>
        <div class="disc" class:zero={!discount}>
          <dt>Cupom {code || '...'}</dt>
          <dd>{discount ? `−${brl(discount)}` : brl(0)}</dd>
        </div>
        <div class="total">
          <dt>Total</dt>
          <dd>{brl(total)}</dd>
        </div>
      </dl>
      <p class="how">
        {#if d}
          {d.how}
        {:else if stop?.id === 'min'}
          O cupom fica na sacola, sem desconto, até os itens chegarem no mínimo.
        {:else}
          O cupom não entra, e o cliente vê o motivo na hora.
        {/if}
      </p>
    </div>
    <div class="flow">
      <p class="flow-title">As perguntas, na ordem em que a Venduá faz</p>
      <Gates gates={list} />
    </div>
  </div>

  <figcaption id="oficina-cap">
    Simulação com a Bolos da Nena, feita com as regras reais dos cupons da Venduá: a mesma ordem de
    perguntas e a mesma conta em centavos.
  </figcaption>
</figure>

<style>
  figure.oficina {
    --paper: var(--surface);
    display: grid;
    gap: 20px;
    margin: 12px 0;
    padding: 20px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--paper);
    box-shadow: var(--shadow-e1);
  }
  @media (min-width: 480px) {
    figure.oficina {
      padding: 24px;
    }
  }
  .preview {
    padding-inline: 4px;
  }

  .panes {
    display: grid;
    gap: 16px;
  }
  @media (min-width: 600px) {
    .panes {
      grid-template-columns: 1fr 1fr;
    }
  }
  fieldset.pane {
    display: grid;
    align-content: start;
    gap: 14px;
    min-width: 0;
    margin: 0;
    padding: 16px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }
  legend {
    float: left;
    width: 100%;
    padding: 0;
    font: 600 1.0625rem/1.3 var(--font-display);
    color: var(--ink);
  }
  legend + * {
    clear: both;
  }

  .field {
    display: grid;
    gap: 6px;
  }
  .field label {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
  }
  .val {
    font-variant-numeric: tabular-nums;
  }
  .code-in {
    min-height: 44px;
    padding: 0 12px;
    border: 1.5px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    font: 700 1.0625rem/1 var(--font-display);
    letter-spacing: 0.05em;
  }
  .code-in[aria-invalid='true'] {
    border-color: var(--danger);
  }
  figure.oficina p.help {
    font-size: 0.8125rem;
    line-height: 1.35;
    color: var(--ink-muted);
  }
  figure.oficina p.help.bad {
    color: var(--danger);
    font-weight: 600;
  }
  input[type='range'] {
    width: 100%;
    min-height: 44px;
    margin: 0;
    accent-color: var(--primary);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chips.stack {
    display: grid;
  }
  .chip {
    position: relative;
    display: flex;
  }
  .chip input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .chip span {
    display: flex;
    flex: 1;
    align-items: center;
    min-height: 44px;
    padding: 0 14px;
    border: 1.5px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
  }
  .chip input:checked + span {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--on-primary);
  }
  .chip input:focus-visible + span {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .toggles {
    display: grid;
  }
  .tog {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--ink);
    cursor: pointer;
  }
  .tog input {
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--primary);
  }

  ul.items {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  ul.items li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.9375rem;
    line-height: 1.3;
  }
  .item {
    display: grid;
    min-width: 0;
  }
  .name {
    color: var(--ink);
    font-weight: 600;
  }
  .price {
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .stepper {
    display: flex;
    flex: none;
    align-items: center;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
  }
  .stepper button {
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--ink);
    font: 600 1.25rem/1 var(--font-sans);
    cursor: pointer;
  }
  .stepper button:disabled {
    color: var(--ink-faint);
    cursor: default;
  }
  .stepper button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }
  .stepper output {
    min-width: 1.2em;
    text-align: center;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .result {
    display: grid;
    gap: 20px;
  }
  .receipt {
    display: grid;
    gap: 12px;
    padding: 16px;
    border-radius: var(--radius-md);
    border: 1.5px dashed var(--line-strong);
  }
  dl {
    display: grid;
    gap: 4px;
    margin: 0;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  dd {
    margin: 0;
    color: var(--ink);
  }
  dl .disc dd {
    color: var(--success);
    font-weight: 700;
  }
  dl .disc.zero dd {
    color: var(--ink-muted);
    font-weight: 500;
  }
  dl .total {
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--line-strong);
    font: 600 1.125rem/1.4 var(--font-display);
    color: var(--ink);
  }
  figure.oficina p.how {
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink);
  }
  figure.oficina p.flow-title {
    margin-bottom: 12px;
    font: 600 1.0625rem/1.3 var(--font-display);
    color: var(--ink);
  }
  @media (min-width: 600px) {
    .result {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      align-items: start;
    }
  }

  figure.oficina figcaption {
    max-width: none;
    text-align: left;
  }
</style>
