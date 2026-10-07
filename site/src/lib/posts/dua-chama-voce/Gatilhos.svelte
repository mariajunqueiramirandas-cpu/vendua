<script lang="ts">
  import { DEFAULTS, brl, triggerOf, type Trigger } from './rules';

  // "Passe para mim quando": the store's switches beside sample messages, each lit by the rule
  // that fires on it. The words are signals.ts's own; the big order and cash rules are
  // tools-order.ts's.
  let complaint = $state(DEFAULTS.handoff.complaint);
  let allergy = $state(DEFAULTS.handoff.allergy);
  let above = $state(DEFAULTS.handoff.above);
  let newCash = $state(DEFAULTS.handoff.newCash);
  let mine = $state('Oi, o pedido veio errado');

  const NAME: Record<Trigger, string> = {
    pessoa: 'pediu uma pessoa',
    pagamento: 'pagamento',
    reclamacao: 'reclamação ou atraso',
    alergia: 'alergia ou restrição',
    grande: 'pedido grande',
    dinheiro: 'cliente novo pagando em dinheiro',
  };

  type Sample = {
    who: string;
    text: string;
    kind?: 'foto' | 'sacola' | 'dinheiro';
    cents?: number;
  };
  const SAMPLES: Sample[] = [
    { who: 'Bia', text: 'Oi! Tem bolo de cenoura com brigadeiro hoje?' },
    { who: 'Luiz', text: 'Cadê meu pedido? Tá demorando muito' },
    { who: 'Mariana', text: 'Esse bolo leva amendoim? Meu filho tem alergia' },
    { who: 'Rafa', text: 'Quero falar com uma pessoa, por favor' },
    { who: 'Carla', text: 'Foto do comprovante do Pix', kind: 'foto' },
    { who: 'Jorge', text: 'Sacola para uma festa', kind: 'sacola', cents: 48_000 },
    { who: 'Paula', text: 'Primeira vez aqui! Vou pagar em dinheiro', kind: 'dinheiro' },
  ];

  const rules = $derived({ complaint, allergy });
  const fire = (s: Sample): Trigger | null => {
    if (s.kind === 'foto') return 'pagamento';
    const t = triggerOf(s.text, rules);
    if (t) return t;
    if (s.kind === 'sacola' && above && (s.cents ?? 0) > DEFAULTS.aboveCents) return 'grande';
    if (s.kind === 'dinheiro' && newCash) return 'dinheiro';
    return null;
  };
  const lit = $derived(SAMPLES.map((s) => ({ s, t: fire(s) })));
  const count = $derived(lit.filter((x) => x.t).length);
  const firing = $derived(new Set(lit.map((x) => x.t).filter(Boolean)));

  const tried = $derived(mine.trim() ? triggerOf(mine.slice(0, 200), rules) : null);
</script>

<figure class="gatilhos" aria-labelledby="gatilhos-cap">
  <div class="board">
    <div class="switches">
      <p class="head">Passe para mim quando</p>
      <ul class="always">
        <li class:hot={firing.has('pessoa')}>
          <span class="led" aria-hidden="true"></span>
          <span class="txt"><strong>O cliente pede uma pessoa</strong></span>
          <span class="fixed">sempre</span>
        </li>
        <li class:hot={firing.has('pagamento')}>
          <span class="led" aria-hidden="true"></span>
          <span class="txt"><strong>Pagamento</strong> em discussão ou comprovante em foto</span>
          <span class="fixed">sempre</span>
        </li>
      </ul>
      <div class="toggles">
        <label class:hot={firing.has('reclamacao')}>
          <span class="led" aria-hidden="true"></span>
          <span class="txt"
            ><strong>Reclamação ou atraso</strong> Ele pede desculpa, diz o que sabe do pedido e chama
            você.</span
          >
          <input type="checkbox" role="switch" bind:checked={complaint} />
        </label>
        <label class:hot={firing.has('alergia')}>
          <span class="led" aria-hidden="true"></span>
          <span class="txt"
            ><strong>Alergia ou restrição</strong> Ele não arrisca: chama você antes de responder.</span
          >
          <input type="checkbox" role="switch" bind:checked={allergy} />
        </label>
        <label class:hot={firing.has('grande')}>
          <span class="led" aria-hidden="true"></span>
          <span class="txt"
            ><strong
              >{above ? `Pedido acima de ${brl(DEFAULTS.aboveCents)}` : 'Pedido grande'}</strong
            >
            Para você conferir antes de ele fechar.</span
          >
          <input type="checkbox" role="switch" bind:checked={above} />
        </label>
        <label class:hot={firing.has('dinheiro')}>
          <span class="led" aria-hidden="true"></span>
          <span class="txt"
            ><strong>Cliente novo pagando em dinheiro</strong> Para você confirmar o troco e o endereço.</span
          >
          <input type="checkbox" role="switch" bind:checked={newCash} />
        </label>
      </div>
    </div>

    <div class="inbox">
      <p class="head" aria-live="polite">
        {count} de {SAMPLES.length} conversas chamariam você
      </p>
      <ul class="msgs">
        {#each lit as { s, t } (s.who)}
          <li class:hot={!!t}>
            <p class="who">{s.who}</p>
            <p class="text" class:meta={!!s.kind && s.kind !== 'dinheiro'}>
              {#if s.kind === 'sacola'}{s.text}: {brl(s.cents ?? 0)}{:else}{s.text}{/if}
            </p>
            <p class="result">
              {#if t}
                <svg viewBox="0 0 16 16" aria-hidden="true"
                  ><path
                    d="M8 1.5a4 4 0 0 0-4 4v2.6L2.6 10.5h10.8L12 8.1V5.5a4 4 0 0 0-4-4ZM6.3 12.5a1.8 1.8 0 0 0 3.4 0"
                  /></svg
                >Chama você: {NAME[t]}
              {:else}
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>O
                Duá segue
              {/if}
            </p>
          </li>
        {/each}
      </ul>
    </div>
  </div>

  <div class="try">
    <label for="dcv-try">Escreva como um cliente escreveria</label>
    <input id="dcv-try" type="text" maxlength="200" autocomplete="off" bind:value={mine} />
    <p class="out" class:hot={!!tried} aria-live="polite">
      {#if tried}
        Chama você: {NAME[tried]}. O cliente lê “Vou chamar alguém da loja para te ajudar com isso.”
      {:else if mine.trim()}
        Nenhuma dessas palavras. O Duá segue a conversa, e ainda chama você se não souber resolver.
      {:else}
        Escreva uma mensagem para ver qual aviso ela dispara.
      {/if}
    </p>
  </div>

  <figcaption id="gatilhos-cap">
    Feito com as regras reais do Duá: as mesmas palavras que o código procura antes de qualquer IA
    ler a mensagem, e os mesmos padrões de fábrica (reclamação e alergia ligados, pedido grande e
    dinheiro desligados). Os nomes e a sacola são exemplos.
  </figcaption>
</figure>

<style>
  figure.gatilhos {
    margin: 12px 0;
    display: grid;
    gap: 18px;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-e1);
    container-type: inline-size;
  }
  .board {
    display: grid;
    gap: 18px;
  }
  @container (min-width: 580px) {
    .board {
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
      align-items: start;
    }
  }
  figure.gatilhos p {
    margin: 0;
  }
  figure.gatilhos p.head {
    margin-bottom: 10px;
    font: 600 1rem/1.3 var(--font-display);
    color: var(--ink);
  }
  figure.gatilhos ul {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure.gatilhos li {
    font-size: 0.9375rem;
    line-height: 1.45;
  }

  .always li,
  .toggles label {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 8px 0;
    border-top: 1px solid var(--line);
    color: var(--ink-muted);
  }
  .always li:first-child {
    border-top: 0;
  }
  .toggles label {
    cursor: pointer;
    font-size: 0.875rem;
    line-height: 1.4;
  }
  .txt strong {
    display: block;
    font-size: 0.9375rem;
    font-weight: 650;
    color: var(--ink);
  }
  .always .txt {
    font-size: 0.875rem;
  }
  .always .txt strong {
    display: inline;
  }
  .led {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1.5px var(--ink-faint);
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .hot > .led {
    background: var(--warning);
    box-shadow: 0 0 0 3px var(--warning-soft);
  }
  .fixed {
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--surface-sunken);
    font-size: 0.8125rem;
    font-weight: 650;
    color: var(--ink);
  }

  /* the switch */
  input[type='checkbox'] {
    appearance: none;
    position: relative;
    width: 46px;
    height: 28px;
    margin: 0;
    border-radius: 999px;
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
    cursor: pointer;
    transition: background var(--duration-quick) var(--ease-soft);
  }
  input[type='checkbox']::after {
    content: '';
    position: absolute;
    top: 4px;
    left: 4px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--ink-muted);
    transition: transform var(--duration-quick) var(--ease-soft);
  }
  input[type='checkbox']:checked {
    background: var(--primary);
    box-shadow: none;
  }
  input[type='checkbox']:checked::after {
    transform: translateX(18px);
    background: var(--on-primary);
  }
  input[type='checkbox']:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 3px;
  }

  .msgs li {
    display: grid;
    gap: 2px;
    padding: 10px 12px;
    border-radius: 14px;
    margin-bottom: 6px;
    background: var(--surface-sunken);
    border-left: 3px solid transparent;
  }
  .msgs li.hot {
    background: var(--warning-soft);
    border-left-color: var(--warning);
  }
  figure.gatilhos p.who {
    font-size: 0.8125rem;
    font-weight: 650;
    color: var(--ink-muted);
  }
  figure.gatilhos p.text {
    font-size: 0.9375rem;
    line-height: 1.4;
    color: var(--ink);
  }
  figure.gatilhos p.text.meta {
    font-style: italic;
    color: var(--ink-muted);
  }
  figure.gatilhos p.result {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-size: 0.8125rem;
    font-weight: 650;
    color: var(--ink-muted);
  }
  .hot p.result {
    color: var(--warning);
  }
  .result svg {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .try {
    display: grid;
    gap: 8px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .try label {
    font: 600 0.9375rem/1.3 var(--font-display);
    color: var(--ink);
  }
  .try input {
    min-height: 48px;
    padding: 0 14px;
    border: 0;
    border-radius: 12px;
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    font: inherit;
    font-size: 1rem;
    color: var(--ink);
  }
  .try input:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  figure.gatilhos p.out {
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  figure.gatilhos p.out.hot {
    color: var(--ink);
    font-weight: 600;
  }

  figure.gatilhos figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .led,
    input[type='checkbox'],
    input[type='checkbox']::after {
      transition: none;
    }
  }
</style>
