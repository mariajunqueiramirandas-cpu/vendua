<script lang="ts">
  // Which cable works with which device: the Windows agent prints through the Windows queue (USB,
  // with the printer installed), raw TCP 9100 and COM ports; the Android one over USB host,
  // Bluetooth Classic and TCP 9100 (docs/adr/0027-print-agents.md, apps/print-agents/*/README.md).
  // The how-to lines are the admin's and the apps' own words.

  type Way = 'usb' | 'rede' | 'bt' | 'com';
  const WAYS: {
    id: Way;
    name: string;
    windows: string | null;
    android: string | null;
  }[] = [
    {
      id: 'usb',
      name: 'USB',
      windows:
        'Instale a impressora no Windows, com o programa dela, como qualquer impressora. O app usa a fila do Windows.',
      android:
        'Ligue o cabo e o Android oferece o app sozinho. Ele pede permissão uma vez para cada impressora. Alguns tablets precisam de um adaptador OTG.',
    },
    {
      id: 'rede',
      name: 'Rede',
      windows:
        'Impressora ligada no roteador, na porta 9100. O app procura na rede do computador, e você também pode digitar o IP no painel.',
      android:
        'Impressora ligada no roteador, na porta 9100. No painel, em impressora de rede, digite o IP que sai no papel de autoteste.',
    },
    {
      id: 'bt',
      name: 'Bluetooth',
      windows: null,
      android:
        'Pareie a impressora nas configurações de Bluetooth do tablet (o PIN costuma ser 0000 ou 1234) e escolha ela no app, em Adicionar impressora.',
    },
    {
      id: 'com',
      name: 'Porta COM',
      windows: 'Para a impressora de porta serial: o app lista as portas COM do computador.',
      android: null,
    },
  ];

  let pick = $state<Way>('usb');
  const way = $derived(WAYS.find((w) => w.id === pick)!);
</script>

<figure class="cx" aria-label="Que ligação funciona em cada aparelho">
  <div class="panel">
    <table>
      <caption class="sr">Ligações da impressora por aparelho</caption>
      <thead>
        <tr>
          <th scope="col"><span class="sr">Ligação</span></th>
          <th scope="col">Computador Windows</th>
          <th scope="col">Tablet Android</th>
        </tr>
      </thead>
      <tbody>
        {#each WAYS as w (w.id)}
          <tr class:on={pick === w.id}>
            <th scope="row">
              <button type="button" aria-pressed={pick === w.id} onclick={() => (pick = w.id)}>
                {w.name}
              </button>
            </th>
            {#each [w.windows, w.android] as how, k (k)}
              <td>
                <span class="mark" class:yes={!!how}>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    {#if how}
                      <path d="M3.5 8.5l3 3 6-7" />
                    {:else}
                      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                    {/if}
                  </svg>
                  {how ? 'funciona' : 'não'}
                </span>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="how" aria-live="polite">
      <p class="how-title"><strong>{way.name}</strong>, passo a passo</p>
      <div class="cols">
        <div class="col">
          <p class="dev">No computador Windows</p>
          <p>{way.windows ?? 'O app do Windows não usa essa ligação. Prefira USB ou rede.'}</p>
        </div>
        <div class="col">
          <p class="dev">No tablet Android</p>
          <p>
            {way.android ?? 'Tablet não tem porta serial. Use USB, rede ou Bluetooth.'}
          </p>
        </div>
      </div>
    </div>
  </div>
  <figcaption>
    Toque numa ligação para ver como se conecta. Vale para qualquer térmica ESC/POS de 58 ou 80 mm.
  </figcaption>
</figure>

<style>
  figure.cx {
    margin: 12px 0;
    display: grid;
    gap: 14px;
  }
  .panel {
    display: grid;
    gap: 18px;
    padding: 14px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 4px;
    table-layout: fixed;
  }
  th,
  td {
    padding: 0;
    text-align: left;
    vertical-align: middle;
  }
  thead th {
    padding: 0 8px 4px;
    font: 600 0.8125rem/1.25 var(--font-sans);
    color: var(--ink-muted);
  }
  thead th:first-child {
    width: 34%;
  }
  tbody tr > * {
    background: var(--surface-sunken);
  }
  tbody tr > :first-child {
    border-radius: 12px 0 0 12px;
  }
  tbody tr > :last-child {
    border-radius: 0 12px 12px 0;
  }
  tbody tr.on > * {
    background: var(--spark-soft);
  }
  th button {
    width: 100%;
    min-height: 48px;
    padding: 0 12px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: var(--ink);
    font: 600 1rem/1.2 var(--font-display);
    text-align: left;
    cursor: pointer;
  }
  th button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }
  tr.on th button {
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 5px;
  }
  td {
    padding: 0 8px;
  }
  .mark {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink-muted);
  }
  .mark.yes {
    color: color-mix(in srgb, var(--success) 75%, var(--ink));
  }
  @media (prefers-color-scheme: dark) {
    .mark.yes {
      color: var(--success);
    }
  }
  .mark svg {
    width: 16px;
    height: 16px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .how {
    display: grid;
    gap: 12px;
    padding: 4px 4px 2px;
  }
  figure.cx p {
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  figure.cx .how-title {
    font-size: 1rem;
    color: var(--ink);
  }
  .how-title strong {
    font-family: var(--font-display);
  }
  .cols {
    display: grid;
    gap: 14px;
  }
  .col {
    display: grid;
    gap: 4px;
  }
  figure.cx .dev {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  figure.cx figcaption {
    max-width: 46ch;
    margin-inline: auto;
  }

  @media (min-width: 560px) {
    .panel {
      padding: 18px 20px 20px;
    }
    .cols {
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
  }
</style>
