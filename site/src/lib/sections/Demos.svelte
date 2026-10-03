<script lang="ts">
  import { onMount } from 'svelte';
  import Section from '$lib/components/Section.svelte';
  import Cozinha from '$lib/demos/Cozinha.svelte';
  import Loja from '$lib/demos/Loja.svelte';
  import Pedido from '$lib/demos/Pedido.svelte';
  import Vendedor from '$lib/demos/Vendedor.svelte';

  // "Veja funcionando": the four demos behind one tab bar, one at a time. Without JavaScript the tabs
  // can't switch, so every demo shows, stacked, in its finished state.
  const TABS = [
    {
      id: 'vendedor',
      tab: 'Vendedor',
      title: 'Uma vendedora que nunca larga o WhatsApp.',
      lead: 'A Ana atende os seus clientes no WhatsApp da loja e no site: tira dúvidas, monta o pedido e manda o Pix. Quando precisa de você, ela chama.',
      points: [
        'Preços, taxas e horários vêm sempre da sua loja, nunca inventados',
        'Você escolhe quando ela responde e assume a conversa quando quiser',
        `No Venduá Bandeira e no Pangolin`,
      ],
      Demo: Vendedor,
    },
    {
      id: 'pedido',
      tab: 'Pedido',
      title: 'Um toque aceita. Outro avisa que saiu.',
      lead: 'O pedido chega com som e aviso no celular, mesmo com o app fechado. Você aceita dali mesmo, e o cliente acompanha cada passo.',
      points: [
        'Aceite com o tempo de preparo: 15, 30 ou 45 minutos',
        'O cliente compra sem criar conta e acompanha até chegar',
        'Acabou a massa? Pause a loja em dois toques',
      ],
      Demo: Pedido,
    },
    {
      id: 'cozinha',
      tab: 'Cozinha',
      title: 'A cozinha vê o pedido na hora.',
      lead: 'Na tela da cozinha, cada pedido entra na ordem de chegada. Marque item por item, e o pedido pronto avisa o balcão.',
      points: [
        'Cada estação vê só o que é dela',
        'A comanda sai impressa sozinha, se você quiser',
        'No Venduá Bandeira e no Pangolin',
      ],
      Demo: Cozinha,
    },
    {
      id: 'loja',
      tab: 'Sua loja',
      title: 'A loja é sua, com a sua cara.',
      lead: 'Você responde umas perguntas do Duá e a loja vai se montando do lado, do jeito que o cliente vai ver. Em cerca de uma hora ela está no ar.',
      points: [
        'O seu nome, as suas cores e o seu cardápio',
        'Endereço próprio: seunome.vendua.com.br',
        'Mude o que quiser depois, pelo celular',
      ],
      Demo: Loja,
    },
  ] as const;
  type TabId = (typeof TABS)[number]['id'];

  let live = $state(false);
  let current = $state<TabId>('vendedor');

  // `#demo-<id>` (a plan card's perk, a deep link) opens that demo and brings the section into view
  function fromHash() {
    const want = location.hash.startsWith('#demo-') ? location.hash.slice(6) : null;
    if (!TABS.some((t) => t.id === want)) return false;
    current = want as TabId;
    return true;
  }

  onMount(() => {
    const want = new URLSearchParams(location.search).get('demo');
    if (TABS.some((t) => t.id === want)) current = want as TabId;
    const onHash = () => {
      if (fromHash()) document.getElementById('veja')?.scrollIntoView({ block: 'start' });
    };
    onHash();
    addEventListener('hashchange', onHash);
    live = true;
    return () => removeEventListener('hashchange', onHash);
  });

  // arrow keys move between tabs (WAI-ARIA tabs pattern)
  function onKey(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === current);
    const next =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length]!;
    current = t.id;
    document.getElementById(`tab-${t.id}`)?.focus();
  }
</script>

<Section id="veja" sky="linear-gradient(var(--sky-2), var(--sky-3))" labelledby="veja-t">
  <div class="head">
    <h2 id="veja-t" class="t-display">Veja funcionando.</h2>
    <p class="t-lede">
      Toque, escolha, aceite: cada parte do Venduá, de verdade, do jeito que você vai usar.
    </p>
  </div>

  {#if live}
    <div
      class="tabs"
      role="tablist"
      aria-label="O que você quer ver"
      tabindex="-1"
      onkeydown={onKey}
    >
      {#each TABS as t (t.id)}
        <button
          type="button"
          role="tab"
          id="tab-{t.id}"
          aria-selected={current === t.id}
          aria-controls="demo-{t.id}"
          tabindex={current === t.id ? 0 : -1}
          onclick={() => (current = t.id)}>{t.tab}</button
        >
      {/each}
    </div>
  {/if}

  {#each TABS as t (t.id)}
    <div
      class="panel"
      id="demo-{t.id}"
      role={live ? 'tabpanel' : undefined}
      aria-labelledby={live ? `tab-${t.id}` : undefined}
      hidden={live && current !== t.id}
    >
      <div class="copy">
        <h3 class="t-title-1">{t.title}</h3>
        <p>{t.lead}</p>
        <ul class="points">
          {#each t.points as p (p)}<li>{p}</li>{/each}
        </ul>
      </div>
      <div class="stage">
        <t.Demo />
      </div>
    </div>
  {/each}
</Section>

<style>
  .head {
    max-width: 640px;
    margin-bottom: clamp(24px, 4vw, 40px);
  }
  .tabs {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    margin-bottom: clamp(24px, 4vw, 40px);
    border-radius: 999px;
    background: var(--surface-sunken);
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs button {
    flex: none;
    min-height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-muted);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--duration-quick) var(--ease-soft),
      color var(--duration-quick) var(--ease-soft);
  }
  /* four tabs fit a 343 px row without scrolling */
  @media (max-width: 420px) {
    .tabs {
      display: flex;
      gap: 2px;
    }
    .tabs button {
      flex: 1 1 auto;
      padding: 0 10px;
      font-size: 0.9375rem;
    }
  }
  .tabs button[aria-selected='true'] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-e1);
  }
  .tabs button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .panel {
    display: grid;
    gap: clamp(24px, 4vw, 56px);
    align-items: center;
  }
  .panel + .panel:not([hidden]) {
    margin-top: 64px;
  }
  .panel[hidden] {
    display: none;
  }
  @media (min-width: 900px) {
    .panel {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    }
  }
  .copy {
    max-width: 480px;
  }
  .copy p {
    color: var(--ink-muted);
  }
  /* phones: the demo says it; the points would only add scroll */
  @media (max-width: 599px) {
    .points {
      display: none;
    }
  }
  .points {
    margin: 20px 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 10px;
  }
  .points li {
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .stage {
    min-width: 0;
    display: grid;
    justify-items: center;
  }
</style>
