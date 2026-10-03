<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import Dua, { type Pose } from '$lib/components/Dua.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import { clock } from '../clock';
  import {
    answer,
    brl,
    finished,
    greeting,
    stamp,
    start,
    type Chip,
    type Msg,
    type State,
  } from './script';

  // The customer's side of the store's WhatsApp: the visitor taps a reply, Duá answers after a
  // short "escrevendo". Without `live` it is the finished conversation, still.
  let { live, reduced }: { live: boolean; reduced: boolean } = $props();
  // Vendedor.svelte remounts this when it goes live: `live` never changes in one instance
  const still = untrack(() => !live);

  const s: State = $state(still ? finished() : start());
  let typing = $state(false);
  let done = $state(still);
  let copied = $state(false);
  let chipsEl: HTMLDivElement | undefined = $state();

  const t = clock(() => reduced);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => {
    t.stop();
    clearTimeout(copyTimer);
  });

  const now = $derived(s.msgs.at(-1)?.time ?? '9:41');

  // Duá's face sits by the last message of each of its runs, as WhatsApp does in a group; the
  // newest one thinks while it types and smiles once the order is done
  const theirs = (m: Msg | undefined) => !!m && m.kind !== 'me';
  const tail = (i: number) =>
    theirs(s.msgs[i]) && !theirs(s.msgs[i + 1]) && !(typing && i === s.msgs.length - 1);
  const poseAt = (i: number): Pose =>
    done && i === s.msgs.length - 1 ? 'avatar-feliz' : 'avatar-ola';

  // Duá types roughly as long as it writes, within the 600–1400 ms the demos keep to
  const typeFor = (text: string) => Math.min(1400, 600 + text.length * 9);

  async function say(replies: ReturnType<typeof greeting>['replies'], chips: Chip[]) {
    for (const r of replies) {
      const text = r.kind === 'dua' ? r.text : '';
      typing = true;
      await t.wait(r.kind === 'dua' ? typeFor(text) : 700);
      typing = false;
      s.msgs.push(stamp(s, r));
    }
    s.chips = chips;
  }

  async function pick(c: Chip) {
    const hadFocus = !!chipsEl?.contains(document.activeElement);
    s.chips = [];
    if (hadFocus) chipsEl?.focus({ preventScroll: true });
    s.minute++;
    const a = answer(s, c.id);
    s.msgs.push(stamp(s, { kind: 'me', text: a.said }));
    await t.wait(450);
    await say(a.replies, a.chips);
    if (a.done) done = true;
    if (hadFocus) {
      await tick();
      chipsEl?.querySelector('button')?.focus({ preventScroll: true });
    }
  }

  function copy() {
    copied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1600);
  }

  onMount(() => {
    if (still) return;
    void t.wait(400).then(() => say(greeting().replies, greeting().chips));
  });
</script>

{#snippet face(pose: Pose)}
  <span class="face" aria-hidden="true"><Dua {pose} size={40} /></span>
{/snippet}

{#snippet mark()}
  <span class="mark">
    <svg viewBox="0 0 16 16" aria-hidden="true"
      ><path d="M8 1.6 2.6 3.6v3.9c0 3.2 2.3 5.8 5.4 6.9 3.1-1.1 5.4-3.7 5.4-6.9V3.6Z" /><path
        d="m5.6 8 1.7 1.7 3.2-3.3"
      /></svg
    >
    calculado pela loja
  </span>
{/snippet}

<div class="vend">
  <div class="row">
    <div class="device">
      <Phone width={320} time={now}>
        <div class="app">
          <header class="bar">
            <span class="back" aria-hidden="true"></span>
            <span class="avatar" aria-hidden="true">B</span>
            <span class="who">
              <strong>Bolos da Nena</strong>
              <span>Duá, assistente virtual</span>
            </span>
          </header>

          <div class="scroll">
            <div
              class="log"
              class:anim={live && !reduced}
              role="log"
              aria-live="polite"
              aria-label="Conversa com a Bolos da Nena"
            >
              <p class="day">hoje</p>
              {#each s.msgs as m, i (i)}
                {#if m.kind === 'me'}
                  <div class="msg me">
                    <span class="sr-only">Você:</span>
                    <p>{m.text}</p>
                    <time>{m.time}</time>
                  </div>
                {:else if m.kind === 'dua'}
                  <div class="msg dua">
                    <span class="sr-only">Duá:</span>
                    <p>{m.text}</p>
                    <time>{m.time}</time>
                    {#if tail(i)}{@render face(poseAt(i))}{/if}
                  </div>
                {:else if m.kind === 'summary'}
                  <figure class="msg paper receipt">
                    <figcaption><span>Seu pedido</span>{@render mark()}</figcaption>
                    <table>
                      <caption class="sr-only"
                        >Seu pedido, calculado pela loja: total {brl(m.totalCents)}</caption
                      >
                      <tbody>
                        {#each m.lines as l (l.text)}
                          <tr><td>{l.text}</td><td class="num">{brl(l.cents)}</td></tr>
                        {/each}
                        {#if m.mode === 'delivery'}
                          <tr
                            ><td>Entrega · {m.address}</td><td class="num">{brl(m.feeCents)}</td
                            ></tr
                          >
                        {/if}
                      </tbody>
                      <tfoot>
                        <tr><th scope="row">Total</th><td class="num">{brl(m.totalCents)}</td></tr>
                      </tfoot>
                    </table>
                    <p class="meta">
                      {[
                        m.eta ? `chega em ${m.eta}` : 'retirada na loja',
                        `pagamento: ${m.payment}`,
                      ].join(' · ')}
                    </p>
                    {#if tail(i)}{@render face(poseAt(i))}{/if}
                  </figure>
                {:else if m.kind === 'pix'}
                  <figure class="msg paper">
                    <figcaption><span>Pix</span>{@render mark()}</figcaption>
                    <p class="lead">
                      Pix do pedido #{m.orderNumber} ·
                      <strong class="num">{brl(m.totalCents)}</strong>
                      · válido até {m.until}
                    </p>
                    <p class="hint">
                      Copie o código abaixo e cole no app do seu banco, em Pix copia e cola.
                    </p>
                    <p class="code" title={m.code}>{m.code}</p>
                    {#if live}
                      <button type="button" class="pixcopy" onclick={copy} aria-live="polite">
                        {copied ? 'copiado' : 'copiar código'}
                      </button>
                    {/if}
                    {#if tail(i)}{@render face(poseAt(i))}{/if}
                  </figure>
                {:else if m.kind === 'order'}
                  <figure class="msg paper">
                    <figcaption><span>Pedido</span>{@render mark()}</figcaption>
                    <p class="lead"><strong>Pedido #{m.number}</strong> · {m.state}</p>
                    <p class="hint">
                      Total <strong class="num">{brl(m.totalCents)}</strong> · {m.payment}
                    </p>
                    {#if tail(i)}{@render face(poseAt(i))}{/if}
                  </figure>
                {/if}
              {/each}
              {#if typing}
                <div class="msg dua typing">
                  <span class="sr-only">Duá está escrevendo</span>
                  <span class="dot" aria-hidden="true"></span><span class="dot" aria-hidden="true"
                  ></span><span class="dot" aria-hidden="true"></span>
                  {@render face('avatar-pensando')}
                </div>
              {/if}
            </div>
          </div>

          {#if live && !done}
            <div
              class="chips"
              role="group"
              aria-label="Respostas para tocar"
              tabindex="-1"
              bind:this={chipsEl}
            >
              {#each s.chips as c (c.id)}
                <button type="button" onclick={() => pick(c)}>{c.label}</button>
              {/each}
            </div>
          {/if}
          <div class="composer" aria-hidden="true">
            <span class="field">Mensagem</span>
            <span class="send"></span>
          </div>
        </div>
      </Phone>
    </div>
    <p class="aside" class:shown={done}>O pedido entra na tela da cozinha como qualquer outro.</p>
  </div>
</div>

<style>
  .vend {
    width: 100%;
    container: vend / inline-size;
  }
  .row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  .device {
    width: 100%;
    max-width: 320px;
    /* the page never follows the chat: nothing in here is a scroll anchor */
    overflow-anchor: none;
    display: grid;
    justify-items: center;
  }
  @media (min-width: 900px) {
    .device {
      max-width: 300px;
    }
  }
  .aside {
    display: none;
    margin: 0;
    max-width: 30ch;
    color: var(--ink-muted);
    font-size: 0.9375rem;
    line-height: 1.4;
    text-align: center;
  }
  .aside.shown {
    display: block;
  }
  /* beside the phone when there's room: its place is kept, so the phone never moves */
  @container vend (min-width: 540px) {
    .row {
      flex-direction: row;
      justify-content: center;
      align-items: flex-end;
      gap: 24px;
    }
    .device {
      width: 300px;
      flex: none;
    }
    .aside {
      display: block;
      visibility: hidden;
      width: 180px;
      max-width: none;
      margin-bottom: 18%;
      padding-left: 12px;
      border-left: 2px solid var(--line-strong);
      text-align: left;
    }
    .aside.shown {
      visibility: visible;
    }
  }

  /* ── the app, sized by the phone (cqw = 1% of its width) ── */
  .app {
    /* screen height ~2.05× its width, minus the status bar */
    height: 181cqw;
    display: flex;
    flex-direction: column;
    background: var(--app-bg);
    color: var(--ink);
    font-size: 4.5cqw;
    line-height: 1.38;
    /* the two voices, from the admin's Vendedor tones (ui/vendedor/tones.ts) */
    --dua-bg: var(--spark-soft);
    --dua-edge: color-mix(in srgb, var(--spark) 88%, var(--ink-muted));
    --me-bg: var(--primary);
    --me-ink: var(--on-primary);
  }
  @media (prefers-color-scheme: dark) {
    .app {
      --dua-edge: color-mix(in srgb, var(--spark) 30%, transparent);
      --me-bg: color-mix(in srgb, var(--success) 24%, var(--surface));
      --me-ink: var(--ink);
    }
  }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2.6cqw;
    padding: 1.6cqw 4cqw 2.6cqw 3cqw;
    border-bottom: 1px solid var(--line);
  }
  .back {
    width: 2.6cqw;
    height: 2.6cqw;
    border-left: 0.7cqw solid currentColor;
    border-bottom: 0.7cqw solid currentColor;
    transform: rotate(45deg);
    margin: 0 1cqw 0 1.6cqw;
    opacity: 0.8;
  }
  .avatar {
    width: 9.6cqw;
    height: 9.6cqw;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--spark);
    color: var(--on-spark);
    font: 600 4.6cqw/1 var(--font-display);
  }
  .who {
    display: grid;
    min-width: 0;
    line-height: 1.2;
  }
  .who strong {
    font-weight: 650;
    font-size: 4.5cqw;
  }
  .who span {
    color: var(--ink-muted);
    font-size: 3.6cqw;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    background: var(--surface-sunken);
    /* the scroll starts, and stays, at the newest message: no script needed */
    display: flex;
    flex-direction: column-reverse;
  }
  .log {
    /* the gutter Duá's face sits in */
    --gut: 13cqw;
    display: flex;
    flex-direction: column;
    gap: 1.8cqw;
    padding: 3cqw 3.4cqw 4cqw;
  }
  .day {
    margin: 0 0 1cqw;
    align-self: center;
    padding: 0.8cqw 2.6cqw;
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink-muted);
    font-size: 3.4cqw;
    font-weight: 600;
  }
  .msg {
    max-width: 84%;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .msg:not(.me) {
    position: relative;
    margin-left: var(--gut);
  }
  /* the mascot is forest green: always on a lit disc, cream at night like the admin's .dua-disc */
  .face {
    position: absolute;
    left: calc(-1 * var(--gut));
    bottom: 0;
    width: 11cqw;
    height: 11cqw;
    border-radius: 50%;
    background: var(--spark-soft);
    overflow: hidden;
  }
  .face :global(.dua) {
    display: block;
    width: 100%;
  }
  @media (prefers-color-scheme: dark) {
    .face {
      background: var(--after-ink);
    }
  }
  .msg p {
    margin: 0;
    white-space: pre-line;
  }
  .dua,
  .me {
    display: grid;
    gap: 0.4cqw;
    padding: 2cqw 3.4cqw 1.4cqw;
    border-radius: 6cqw;
  }
  .dua {
    align-self: flex-start;
    border-bottom-left-radius: 2cqw;
    background: var(--dua-bg);
    box-shadow: inset 0 0 0 1px var(--dua-edge);
  }
  .me {
    align-self: flex-end;
    border-bottom-right-radius: 2cqw;
    background: var(--me-bg);
    color: var(--me-ink);
  }
  .msg time {
    justify-self: end;
    font-size: 3.2cqw;
    line-height: 1;
    opacity: 0.72;
    font-variant-numeric: tabular-nums;
  }
  .typing {
    display: flex;
    gap: 1.2cqw;
    padding: 3.6cqw 4.4cqw;
  }
  .dot {
    width: 1.8cqw;
    height: 1.8cqw;
    border-radius: 50%;
    background: var(--ink);
    opacity: 0.35;
    animation: dot 1s ease-in-out infinite;
  }
  .dot:nth-child(3) {
    animation-delay: 160ms;
  }
  .dot:nth-child(4) {
    animation-delay: 320ms;
  }
  @keyframes dot {
    50% {
      opacity: 0.8;
    }
  }
  .anim .msg {
    animation: arrive var(--duration-smooth) var(--ease-soft) both;
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(2cqw);
    }
  }

  /* Core's paper: its figures, never a bubble (ui/vendedor/receipts.tsx) */
  .paper {
    position: relative;
    width: 84%;
    max-width: none;
    align-self: flex-start;
    padding: 2.8cqw 3.6cqw 2.4cqw;
    border-radius: 4.4cqw;
    background: var(--surface);
    box-shadow:
      inset 0 0 0 1px var(--line-strong),
      var(--shadow-e1);
    font-size: 4.1cqw;
    line-height: 1.38;
  }
  @media (prefers-color-scheme: dark) {
    .paper {
      background: var(--surface-raised);
    }
  }
  .receipt::before {
    content: '';
    position: absolute;
    inset: 0 3.4cqw auto;
    border-top: 2px dashed var(--line-strong);
  }
  .paper figcaption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2cqw;
    color: var(--ink-muted);
    font-size: 3.5cqw;
    line-height: 1.2;
  }
  .paper figcaption > span:first-child {
    font-weight: 650;
    color: var(--ink);
  }
  .mark {
    display: inline-flex;
    align-items: center;
    gap: 0.8cqw;
    font-weight: 500;
  }
  .mark svg {
    width: 3.6cqw;
    height: 3.6cqw;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .paper table {
    width: 100%;
    margin-top: 1.6cqw;
    border-collapse: collapse;
  }
  .paper td,
  .paper th {
    padding: 0.7cqw 0;
    vertical-align: top;
    text-align: left;
    font-weight: inherit;
  }
  .num {
    white-space: nowrap;
    font-family: var(--font-display);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .paper td.num {
    padding-left: 2.6cqw;
    text-align: right;
  }
  .paper tfoot tr {
    border-top: 1px solid var(--line);
  }
  .paper tfoot th,
  .paper tfoot td {
    padding-top: 1.4cqw;
    font-weight: 700;
  }
  .paper tfoot td {
    font-size: 4.4cqw;
  }
  .meta,
  .hint {
    color: var(--ink-muted);
    font-size: 3.6cqw;
  }
  .paper .lead {
    margin-top: 1.4cqw;
  }
  .paper .hint {
    margin-top: 0.8cqw;
  }
  .paper .hint strong {
    color: var(--ink);
  }
  .code {
    margin-top: 2cqw !important;
    padding: 1.8cqw 2.4cqw;
    border-radius: 2.4cqw;
    background: var(--surface-sunken);
    font-size: 3.5cqw;
    white-space: nowrap !important;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }
  .pixcopy {
    width: 100%;
    min-height: 44px;
    margin-top: 2cqw;
    border: 0;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font: inherit;
    font-weight: 650;
    cursor: pointer;
  }
  .pixcopy:hover {
    background: var(--primary-hover);
  }

  .chips {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 2cqw;
    min-height: calc(44px + 4.4cqw);
    padding: 2.2cqw 3.4cqw 0;
    background: var(--surface-sunken);
    outline: none;
  }
  .chips button {
    min-height: 44px;
    padding: 0 4.2cqw;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 4.2cqw;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .chips button:hover {
    background: color-mix(in srgb, var(--spark-soft) 60%, var(--surface));
  }
  .chips button:focus-visible,
  .pixcopy:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .composer {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2cqw;
    padding: 2.4cqw 3.4cqw 4.4cqw;
    background: var(--surface-sunken);
  }
  .field {
    flex: 1;
    padding: 2.4cqw 4cqw;
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink-muted);
    font-size: 4cqw;
  }
  .send {
    width: 10cqw;
    height: 10cqw;
    flex: none;
    border-radius: 50%;
    background: var(--primary);
  }
  @media (prefers-reduced-motion: reduce) {
    .anim .msg,
    .dot {
      animation: none;
    }
  }
</style>
