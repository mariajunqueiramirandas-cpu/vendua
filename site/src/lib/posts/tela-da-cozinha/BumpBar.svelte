<script lang="ts">
  import { onMount } from 'svelte';
  import MiniTicket from './MiniTicket.svelte';
  import { UNDO_MS, type Mini } from './rules';

  // The keys of the real screen (apps/admin/src/features/kitchen/parts.tsx SHORTCUTS, Kitchen.tsx):
  // press them on your own keyboard with the little kitchen focused, or tap the keycaps.
  const KEYS: { key: string; cap: string; does: string }[] = [
    { key: '1', cap: '1', does: 'pedido 1' },
    { key: '2', cap: '2', does: 'pedido 2' },
    { key: 'ArrowLeft', cap: '←', does: 'pedido anterior' },
    { key: 'ArrowRight', cap: '→', does: 'próximo pedido' },
    { key: 'ArrowUp', cap: '↑', does: 'item anterior' },
    { key: 'ArrowDown', cap: '↓', does: 'próximo item' },
    { key: ' ', cap: 'Espaço', does: 'item feito' },
    { key: 'Enter', cap: 'Enter', does: 'começar / pronto' },
    { key: 'z', cap: 'Z', does: 'desfazer' },
    { key: 'p', cap: 'P', does: 'prioridade' },
    { key: 't', cap: 'T', does: 'tudo junto' },
    { key: 'e', cap: 'E', does: 'estação' },
    { key: 's', cap: 'S', does: 'som' },
    { key: 'f', cap: 'F', does: 'tela cheia' },
  ];

  const start = (): Mini[] => [
    {
      number: 33,
      name: 'Rafa',
      state: 'confirmed',
      rush: false,
      note: 'Meu filho tem alergia a amendoim, nada de granulado de amendoim por favor.',
      items: [
        { qty: 2, name: 'Fatia de cenoura com brigadeiro', mods: [], done: false },
        { qty: 1, name: 'Bolo de fubá', mods: ['sem erva-doce'], done: false },
      ],
    },
    {
      number: 34,
      name: 'Leo',
      state: 'preparing',
      rush: false,
      note: '',
      items: [
        { qty: 1, name: 'Fatia de fubá com goiabada', mods: [], done: true },
        { qty: 1, name: 'Café coado 300 ml', mods: ['com leite'], done: false },
      ],
    },
  ];

  let tickets = $state(start());
  let sel = $state<number | null>(0);
  let cursor = $state<number | null>(0);
  let readyList = $state<number[]>([]);
  let pending = $state<{ number: number; until: number } | null>(null);
  let tick = $state(0);
  let said = $state('Clique na mini cozinha e use o teclado, ou toque nas teclas abaixo.');
  let hit = $state<string | null>(null);
  let live = $state(false);
  let box: HTMLDivElement;
  onMount(() => (live = true));

  const rail = $derived(
    [...tickets].sort((a, b) => (a.rush !== b.rush ? (a.rush ? -1 : 1) : a.number - b.number)),
  );
  const cur = $derived(sel === null ? undefined : rail[sel]);
  const undoLeft = $derived.by(() => {
    void tick; // re-read the clock on every beat
    return pending ? Math.max(0, Math.ceil((pending.until - Date.now()) / 1000)) : null;
  });

  let fireT: ReturnType<typeof setTimeout> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  function send() {
    if (!pending) return;
    const n = pending.number;
    tickets = tickets.filter((t) => t.number !== n);
    readyList = [n, ...readyList];
    pending = null;
    clearInterval(beat);
    sel = rail.length ? 0 : null;
    cursor = rail.length ? 0 : null;
    said = `Pedido #${n} foi para "pronto": agora o cliente é avisado.`;
  }
  $effect(() => () => {
    clearTimeout(fireT);
    clearInterval(beat);
  });

  function act(key: string) {
    hit = key;
    setTimeout(() => (hit === key ? (hit = null) : null), 160);
    const k = key.length === 1 ? key.toLowerCase() : key;
    const n = rail.length;
    if (k === '1' || k === '2') {
      const i = Number(k) - 1;
      if (i < n) {
        sel = i;
        cursor = 0;
        said = `Pedido #${rail[i]!.number} selecionado.`;
      } else said = `Não há pedido ${k} na tela.`;
      return;
    }
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      if (!n) return;
      const d = k === 'ArrowRight' ? 1 : -1;
      sel = sel === null ? 0 : (sel + d + n) % n;
      cursor = 0;
      said = `Pedido #${rail[sel]!.number} selecionado.`;
      return;
    }
    if (k === 't') return void (said = 'T: na tela de verdade, abre o Tudo junto.');
    if (k === 'e') return void (said = 'E: escolhe a estação desta tela.');
    if (k === 's') return void (said = 'S: liga ou desliga o som da cozinha.');
    if (k === 'f') return void (said = 'F: tela cheia, sem nada em volta.');
    if (k === 'Escape') {
      sel = null;
      cursor = null;
      said = 'Seleção limpa.';
      return;
    }
    if (k === 'z' || k === 'Backspace') {
      if (!pending) return void (said = 'Nada para desfazer.');
      clearTimeout(fireT);
      clearInterval(beat);
      said = `Desfeito: o #${pending.number} voltou para a tela.`;
      pending = null;
      return;
    }
    const t = cur;
    if (!t) return void (said = 'Escolha um pedido com 1, 2 ou as setas.');
    if (pending?.number === t.number) return;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      const m = t.items.length;
      cursor = cursor === null ? 0 : (cursor + (k === 'ArrowDown' ? 1 : -1) + m) % m;
      said = `${t.items[cursor]!.qty}× ${t.items[cursor]!.name}.`;
      return;
    }
    if (k === 'p') {
      t.rush = !t.rush;
      sel = rail.findIndex((x) => x.number === t.number);
      said = t.rush ? `#${t.number} passou na frente.` : `#${t.number} saiu da prioridade.`;
      return;
    }
    if (k === ' ') {
      const i = t.items[cursor ?? 0]!;
      i.done = !i.done;
      const first = t.state === 'confirmed';
      if (first) t.state = 'preparing';
      said = `${i.name}: ${i.done ? 'feito' : 'não feito'}.${first ? ' A primeira marca põe o pedido em "preparando".' : ''}`;
      return;
    }
    if (k === 'Enter') {
      if (t.state === 'confirmed') {
        t.state = 'preparing';
        said = `#${t.number} começou.`;
        return;
      }
      if (pending) send();
      pending = { number: t.number, until: Date.now() + UNDO_MS };
      fireT = setTimeout(send, UNDO_MS);
      beat = setInterval(() => tick++, 250);
      said = `#${t.number} pronto. Você tem 4,5 segundos para desfazer com Z.`;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    const known =
      KEYS.some((x) => x.key === e.key || x.key === e.key.toLowerCase()) ||
      e.key === 'Escape' ||
      e.key === 'Backspace';
    if (!known || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    act(e.key);
  }
  function tap(key: string) {
    act(key);
    box?.focus({ preventScroll: true });
  }
  function reset() {
    clearTimeout(fireT);
    clearInterval(beat);
    tickets = start();
    readyList = [];
    pending = null;
    sel = 0;
    cursor = 0;
    said = 'De novo, do começo.';
  }
</script>

<figure class="bb-w" aria-label="Os atalhos de teclado e do bump bar da tela da cozinha">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="kitchen"
    bind:this={box}
    tabindex="0"
    role="application"
    aria-label="Mini cozinha: com ela em foco, use 1, 2, setas, Espaço, Enter, Z e P"
    {onkeydown}
  >
    <div class="tickets">
      {#each rail as t, k (t.number)}
        <MiniTicket
          {t}
          slot={k + 1}
          selected={sel === k}
          cursor={sel === k ? cursor : null}
          undoLeft={pending?.number === t.number ? undoLeft : null}
        />
      {:else}
        <p class="empty">Nada na fila. Bom trabalho.</p>
      {/each}
    </div>
    <p class="ready tnum">
      Prontos: {readyList.length ? readyList.map((n) => `#${n}`).join(', ') : 'nenhum ainda'}
    </p>
  </div>

  <p class="said" aria-live="polite">{said}</p>

  <div class="bar" role="group" aria-label="Teclas do bump bar">
    {#each KEYS as k (k.key)}
      <button
        type="button"
        class="key"
        class:wide={k.cap.length > 2}
        class:hit={hit === k.key}
        disabled={!live}
        onclick={() => tap(k.key)}
        aria-label="{k.cap}: {k.does}"
      >
        <span class="cap">{k.cap}</span>
        <span class="does">{k.does}</span>
      </button>
    {/each}
  </div>

  <figcaption>
    Exemplo com pedidos da Bolos da Nena. As teclas, o “sem” em vermelho, as palavras de alergia
    marcadas e os 4,5 segundos para desfazer são os da tela de verdade.
    {#if live}<button type="button" class="again" onclick={reset}>recomeçar</button>{/if}
  </figcaption>
</figure>

<style>
  figure.bb-w {
    display: grid;
    gap: 14px;
    margin: 12px 0;
    padding: 20px 14px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }
  .kitchen {
    display: grid;
    gap: 10px;
    padding: 12px;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface-sunken) 50%, var(--bg));
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .kitchen:focus-visible {
    outline: 3px solid var(--primary);
    outline-offset: 3px;
  }
  .tickets {
    display: grid;
    gap: 10px;
    align-items: start;
  }
  figure p.ready,
  figure p.empty {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.4;
    font-weight: 600;
    color: var(--ink-muted);
  }
  figure p.said {
    margin: 0;
    min-height: 3em;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px;
    border-radius: 14px;
    background: var(--bezel);
  }
  .key {
    display: grid;
    justify-items: center;
    gap: 1px;
    flex: 1 0 52px;
    min-height: 52px;
    padding: 6px 4px 7px;
    border: 0;
    border-radius: 8px;
    background: var(--sky-5);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.12),
      inset 0 -3px 0 rgb(0 0 0 / 0.45);
    color: var(--after-ink);
    cursor: pointer;
    transition: translate var(--duration-instant) var(--ease-soft);
  }
  .key.wide {
    flex-basis: 84px;
  }
  .key.hit,
  .key:active {
    translate: 0 2px;
    background: color-mix(in srgb, var(--spark) 30%, var(--sky-5));
  }
  .key:disabled {
    cursor: default;
  }
  .key:focus-visible {
    outline: 2px solid var(--spark);
    outline-offset: 2px;
  }
  .cap {
    font: 700 1rem/1.2 var(--font-display);
  }
  .does {
    font-size: 0.6875rem;
    line-height: 1.2;
    color: var(--after-muted);
    text-align: center;
  }
  figure.bb-w figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
  }
  .again {
    min-height: 44px;
    margin-left: 6px;
    padding: 0 14px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.875rem var(--font-sans);
    cursor: pointer;
  }
  .again:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  @media (min-width: 560px) {
    figure.bb-w {
      padding: 26px 24px 22px;
    }
    .tickets {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .key {
      transition: none;
    }
  }
</style>
