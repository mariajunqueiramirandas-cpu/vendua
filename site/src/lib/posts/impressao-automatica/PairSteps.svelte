<script lang="ts">
  // The three screens, in the words of the Android app (apps/print-agents/android/.../ui/
  // PairingScreens.kt, HomeScreen.kt) and of the admin's pairing sheet (apps/admin/src/features/
  // printers/Printers.tsx PairSheet). Without JavaScript it shows the device already connected.
  let { live }: { live: boolean } = $props();

  type Device = 'android' | 'windows';
  const DEVICES: Record<Device, { name: string; kind: string }> = {
    android: { name: 'Tablet da cozinha', kind: 'Tablet Android' },
    windows: { name: 'Computador do caixa', kind: 'Computador Windows' },
  };
  const CODE = 'K7QD-4MXA';

  let device = $state<Device>('android');
  let approved = $state(true);
  let toast = $state('');

  $effect(() => {
    if (live) approved = false;
  });

  const d = $derived(DEVICES[device]);

  function approve() {
    approved = true;
    toast = `${d.name} conectado`;
  }
</script>

<ol class="steps">
  <li class="step done">
    <p class="n" aria-hidden="true">1</p>
    <p class="title">Instale o Venduá Impressora</p>
    <p class="sub">No aparelho que fica ligado à impressora.</p>
    <div class="pick" role="radiogroup" aria-label="Aparelho">
      {#each Object.entries(DEVICES) as [id, v] (id)}
        <label class:on={device === id}>
          <input
            type="radio"
            name="pair-device"
            value={id}
            bind:group={device}
            onchange={() => {
              if (live) approved = false;
              toast = '';
            }}
          />
          {v.kind}
        </label>
      {/each}
    </div>
  </li>

  <li class="step done">
    <p class="n" aria-hidden="true">2</p>
    <p class="title">Ele mostra um código</p>
    <div class="app" aria-live="polite">
      <p class="app-name">Venduá Impressora</p>
      {#if approved}
        <p class="ok">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
          Conectado. Os pedidos saem automaticamente.
        </p>
        <p class="small">Bolos da Nena</p>
      {:else}
        <p class="small">No painel da loja, em Impressoras, digite este código:</p>
        <p class="code tnum">{CODE}</p>
        <p class="small">Aguardando aprovação. O código vale por 10 minutos.</p>
      {/if}
    </div>
  </li>

  <li class="step" class:done={approved}>
    <p class="n" aria-hidden="true">3</p>
    <p class="title">Você aprova no painel</p>
    <div class="admin">
      <p class="sheet-title">Conectar aparelho</p>
      <p class="field tnum" aria-label="Código digitado">{CODE}</p>
      <div class="who">
        <p><strong>{d.name}</strong></p>
        <p class="small">{d.kind} quer imprimir os pedidos da sua loja.</p>
      </div>
      <button type="button" disabled={!live || approved} onclick={approve}>
        {approved ? 'conectado' : 'conectar'}
      </button>
      {#if toast}<p class="toast" role="status">{toast}</p>{/if}
    </div>
  </li>
</ol>

<style>
  ol.steps {
    display: grid;
    gap: 14px;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: none;
  }
  li.step {
    position: relative;
    display: grid;
    align-content: start;
    gap: 8px;
    padding: 16px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    font-size: inherit;
    line-height: inherit;
  }
  ol.steps p {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.4;
    color: var(--ink-muted);
    text-align: left;
  }
  ol.steps p.n {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
    font: 600 0.9375rem/1 var(--font-display);
    color: var(--ink);
  }
  li.done p.n {
    background: var(--spark);
    box-shadow: none;
    color: var(--on-spark);
  }
  ol.steps p.title {
    font: 600 1.0625rem/1.3 var(--font-display);
    color: var(--ink);
  }
  ol.steps p.small {
    font-size: 0.8125rem;
    line-height: 1.35;
  }
  ol.steps p.sub {
    font-size: 0.875rem;
  }

  .pick {
    display: grid;
    gap: 6px;
    margin-top: 4px;
  }
  .pick label {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
  }
  .pick label.on {
    box-shadow: inset 0 0 0 2px var(--primary);
  }
  .pick label.on::after {
    content: '';
    margin-left: auto;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--primary);
  }
  .pick input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .pick label:has(input:focus-visible) {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .app,
  .admin {
    display: grid;
    gap: 8px;
    padding: 14px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow: var(--shadow-e1);
  }
  ol.steps p.app-name,
  ol.steps p.sheet-title {
    font: 600 0.9375rem/1.2 var(--font-display);
    color: var(--ink);
  }
  ol.steps p.code {
    font: 600 1.25rem/1.1 var(--font-display);
    letter-spacing: 0.06em;
    white-space: nowrap;
    color: var(--ink);
  }
  ol.steps p.ok {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-weight: 600;
    color: var(--success);
  }
  .ok svg {
    flex: none;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  ol.steps p.field {
    padding: 10px 12px;
    border-radius: 10px;
    box-shadow: inset 0 0 0 1px var(--line-strong);
    font-weight: 600;
    letter-spacing: 0.12em;
    color: var(--ink);
  }
  .who {
    display: grid;
    gap: 2px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface-sunken);
  }
  .admin button {
    min-height: 44px;
    border: 0;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font: 600 0.9375rem/1 var(--font-sans);
    cursor: pointer;
  }
  .admin button:disabled {
    background: var(--surface-sunken);
    color: var(--ink-muted);
    cursor: default;
  }
  .admin button:not(:disabled) {
    box-shadow: 0 0 0 3px var(--spark);
  }
  .admin button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 3px;
  }
  ol.steps p.toast {
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--primary);
    color: var(--on-primary);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  @media (min-width: 640px) {
    ol.steps {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    li.step {
      padding: 14px;
    }
  }
</style>
