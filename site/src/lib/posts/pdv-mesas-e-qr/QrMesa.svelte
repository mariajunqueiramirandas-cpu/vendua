<script lang="ts">
  import { MAX_PENDING_AT_TABLE } from './money';
  import { QR_SIZE, modules } from './qr';

  // The order from the table's QR, step by step (ADR 0036; Kernel 1.22.0's checkout and error copy
  // in packages/kernel/src/rules/errors.ts; the cap is MAX_PENDING_AT_TABLE in
  // packages/core/src/modules/place-order.ts). The queue below is the one guard you can try.

  const dots = modules();

  interface Pending {
    number: number;
    name: string;
  }
  const NAMES = ['Bia', 'Leo', 'Duda', 'Rafa', 'Gabi', 'Caio', 'Lia', 'Theo'];
  let seq = 42;
  let named = 2;
  let queue = $state<Pending[]>([
    { number: 40, name: 'Bia' },
    { number: 41, name: 'Leo' },
  ]);
  let kitchen = $state(1);
  let refused = $state(false);
  let said = $state('');

  function send() {
    if (queue.length >= MAX_PENDING_AT_TABLE) {
      refused = true;
      said = 'Pedido recusado: esta mesa já tem pedidos esperando a equipe.';
      return;
    }
    refused = false;
    const p = { number: seq++, name: NAMES[named++ % NAMES.length]! };
    queue.push(p);
    said = `Pedido #${p.number} chegou em Pedidos. ${queue.length} de ${MAX_PENDING_AT_TABLE} esperando a equipe.`;
  }
  function accept() {
    const p = queue.shift();
    if (!p) return;
    refused = false;
    kitchen++;
    said = `Pedido #${p.number} aceito: foi para a cozinha. ${queue.length} de ${MAX_PENDING_AT_TABLE} esperando a equipe.`;
  }
</script>

<figure class="qr-w" aria-label="O caminho de um pedido feito pelo QR da mesa">
  <div class="card">
    <div class="tent" aria-hidden="true">
      <svg viewBox="-2 -2 {QR_SIZE + 4} {QR_SIZE + 4}" class="code">
        <rect x="-2" y="-2" width={QR_SIZE + 4} height={QR_SIZE + 4} rx="2" class="paper" />
        {#each dots as d (d.x * 100 + d.y)}
          <rect x={d.x} y={d.y} width="1.02" height="1.02" />
        {/each}
      </svg>
      <div class="tent-text">
        <span class="tent-store">Bolos da Nena</span>
        <span class="tent-table">Mesa 5</span>
        <span class="tent-hint">Aponte a câmera e peça daqui</span>
      </div>
    </div>

    <ol class="flow">
      <li class="step">
        <span class="dot tnum" aria-hidden="true">1</span>
        <div class="body">
          <p class="what">O cliente aponta a câmera para o QR da mesa.</p>
          <p class="more">
            O cardápio da loja abre e avisa: <q>Você está na Mesa 5</q>. Nada para instalar.
          </p>
          <p class="stop">
            QR trocado pelo gerente, o antigo mostra <q>Esse QR code não vale mais</q>.
          </p>
        </div>
      </li>
      <li class="step">
        <span class="dot tnum" aria-hidden="true">2</span>
        <div class="body">
          <p class="what">No fim do pedido, só o primeiro nome.</p>
          <p class="more">
            No lugar da entrega aparece <q>Na Mesa 5</q>. Sem telefone, sem endereço, sem cadastro.
          </p>
          <p class="stop">
            Loja fechada ou em pausa, o pedido não passa: <q>A loja está fechada agora</q>.
          </p>
        </div>
      </li>
      <li class="step">
        <span class="dot tnum" aria-hidden="true">3</span>
        <div class="body">
          <p class="what">Ele escolhe como pagar.</p>
          <p class="more">
            Pix ou cartão na hora, pelo Mercado Pago, ou <q>Pagar na mesa</q>, que põe o pedido na
            comanda.
          </p>
        </div>
      </li>
      <li class="step shop">
        <span class="dot tnum" aria-hidden="true">4</span>
        <div class="body">
          <p class="what">A equipe aceita antes da cozinha ver.</p>
          <p class="more">
            O pedido toca em Pedidos, com a mesa, como um pedido do cardápio online. Até alguém
            aceitar, ele não vai para a cozinha nem entra na conta.
          </p>

          <div class="queue">
            <p class="q-title">
              Esperando a equipe na Mesa 5
              <span class="tnum">{queue.length} de {MAX_PENDING_AT_TABLE}</span>
            </p>
            <ul class="vagas" aria-label="pedidos da Mesa 5 esperando aceite">
              {#each Array.from({ length: MAX_PENDING_AT_TABLE }, (_, i) => i) as i (i)}
                {@const p = queue[i]}
                <li class="vaga" class:full={!!p}>
                  {#if p}
                    <span class="tnum">#{p.number}</span>
                    <span class="who">{p.name}</span>
                  {:else}
                    <span class="free">vaga</span>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if refused}
              <p class="refuse">
                <strong>Esta mesa já tem pedidos esperando a equipe</strong>
                Assim que a equipe aceitar os anteriores, você pode mandar outro.
              </p>
            {/if}
            <div class="q-actions">
              <button type="button" class="btn ghost" onclick={send}>
                mandar outro pedido da mesa
              </button>
              <button type="button" class="btn" disabled={queue.length === 0} onclick={accept}
                >aceitar o mais antigo</button
              >
            </div>
            <p class="q-foot tnum">
              {kitchen}
              {kitchen === 1 ? 'pedido aceito já está' : 'pedidos aceitos já estão'} na cozinha.
            </p>
            <p class="sr" aria-live="polite">{said}</p>
          </div>
        </div>
      </li>
      <li class="step shop">
        <span class="dot tnum" aria-hidden="true">5</span>
        <div class="body">
          <p class="what">Aceito, vira mais uma rodada da comanda.</p>
          <p class="more">
            Sai na tela da cozinha e na impressora com a mesa. Na comanda, o que foi pago online
            aparece como <q>pago online</q> e fica fora do que falta receber.
          </p>
        </div>
      </li>
      <li class="step">
        <span class="dot tnum" aria-hidden="true">6</span>
        <div class="body">
          <p class="what">O cliente acompanha pelo celular até <q>Servido</q>.</p>
        </div>
      </li>
    </ol>
  </div>
  <figcaption>
    O caminho real de um pedido pelo QR, com os avisos que o cliente vê. A fila é uma simulação com
    a regra da loja: no máximo {MAX_PENDING_AT_TABLE} pedidos da mesma mesa esperando aceite.
  </figcaption>
</figure>

<style>
  figure.qr-w {
    margin: 12px 0;
    display: grid;
    gap: 12px;
  }
  .card {
    display: grid;
    gap: 6px;
    padding: 20px 18px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-e2);
  }
  figure.qr-w p,
  figure.qr-w li {
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink);
  }
  figure.qr-w ol,
  figure.qr-w ul {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  q {
    quotes: '“' '”';
    font-weight: 650;
    color: var(--ink);
  }

  /* the card that stands on the table */
  .tent {
    display: flex;
    align-items: center;
    gap: 16px;
    justify-self: start;
    margin-bottom: 12px;
    padding: 12px 18px 12px 12px;
    border-radius: 14px;
    background: var(--surface-sunken);
    border-bottom: 5px solid var(--line-strong);
  }
  .code {
    width: 84px;
    height: 84px;
    flex: none;
    fill: #123c32;
  }
  .paper {
    fill: #fffdf8;
  }
  .tent-text {
    display: grid;
    gap: 2px;
  }
  .tent-store {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .tent-table {
    font: 600 1.625rem/1.1 var(--font-display);
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .tent-hint {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }

  /* the rail: customer steps on the plain card, the store's on lime */
  figure.qr-w .step {
    position: relative;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 12px;
    padding-bottom: 18px;
  }
  .step:not(:last-child)::before {
    content: '';
    position: absolute;
    left: 16px;
    top: 34px;
    bottom: 0;
    width: 2px;
    background: var(--line-strong);
  }
  .dot {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 2px solid var(--ink);
    background: var(--surface);
    font: 600 0.9375rem/1 var(--font-display);
    color: var(--ink);
  }
  .shop .dot {
    border-color: var(--spark);
    background: var(--spark);
    color: var(--on-spark);
  }
  .body {
    display: grid;
    gap: 6px;
    padding-top: 4px;
    min-width: 0;
  }
  .shop .body {
    padding: 10px 14px 14px;
    margin-top: -6px;
    border-radius: var(--radius-md);
    background: var(--spark-soft);
  }
  figure.qr-w .what {
    font: 600 1.0625rem/1.35 var(--font-display);
    letter-spacing: -0.01em;
  }
  figure.qr-w .more {
    color: var(--ink-muted);
  }
  figure.qr-w .stop {
    padding: 6px 10px;
    border-left: 3px solid var(--danger);
    border-radius: 0 8px 8px 0;
    background: var(--danger-soft);
    font-size: 0.875rem;
  }

  .queue {
    display: grid;
    gap: 10px;
    margin-top: 6px;
    padding: 12px;
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  figure.qr-w .q-title {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
    font-size: 0.875rem;
    font-weight: 650;
  }
  figure.qr-w .vagas {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }
  figure.qr-w .vaga {
    display: grid;
    place-content: center;
    min-height: 54px;
    padding: 4px;
    border: 2px dashed var(--line-strong);
    border-radius: 10px;
    text-align: center;
    font-size: 0.8125rem;
    line-height: 1.25;
  }
  figure.qr-w .vaga.full {
    border: 2px solid var(--warning);
    background: var(--warning-soft);
    font-weight: 650;
  }
  .who {
    font-weight: 500;
    color: var(--ink-muted);
  }
  .free {
    color: var(--ink-muted);
  }
  figure.qr-w .refuse {
    display: grid;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--danger-soft);
    font-size: 0.875rem;
  }
  .refuse strong {
    color: var(--danger);
  }
  .q-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .btn {
    flex: 1 1 12rem;
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid var(--primary);
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font: 600 0.9375rem/1.2 var(--font-sans);
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .btn.ghost {
    border-color: var(--line-strong);
    background: var(--surface);
    color: var(--ink);
  }
  .btn.ghost:hover {
    background: var(--hover);
  }
  figure.qr-w .q-foot {
    font-size: 0.8125rem;
    color: var(--ink-muted);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  figure.qr-w figcaption {
    max-width: none;
    text-align: left;
  }

  @media (prefers-color-scheme: dark) {
    .code {
      fill: #0a100d;
    }
    .paper {
      fill: #f7f4ea;
    }
  }
</style>
