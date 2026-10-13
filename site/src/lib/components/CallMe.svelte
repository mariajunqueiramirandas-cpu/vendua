<script lang="ts">
  import { onMount } from 'svelte';

  // "Prefere conversar antes?": the one form on the site besides the partners' (owner,
  // 2026-10-13). A name and a WhatsApp go to Core (/site/v1/leads, first-party through the site's
  // nginx) as a lead for the team, who call back on WhatsApp. It needs JavaScript to send, so
  // without it nothing shows and the page keeps its one call to action. /privacidade/ says what
  // the form keeps.
  let { tone = 'after' }: { tone?: 'day' | 'after' } = $props();

  const SEGMENTS: [string, string][] = [
    ['', 'O que você vende?'],
    ['doces', 'Doces e bolos'],
    ['salgados', 'Salgados'],
    ['pizzaria', 'Pizza'],
    ['lanches', 'Lanches e hambúrgueres'],
    ['marmitas', 'Marmitas e refeições'],
    ['acai', 'Açaí e sorvetes'],
    ['padaria', 'Padaria e café'],
    ['japonesa', 'Comida japonesa'],
    ['bebidas', 'Bebidas'],
    ['outro', 'Outra coisa'],
  ];

  let ready = $state(false);
  let open = $state(false);
  let phase: 'idle' | 'sending' | 'sent' | 'error' = $state('idle');
  let error = $state('');
  let name = $state('');
  let whatsapp = $state('');
  let segment = $state('');
  let website = $state('');
  onMount(() => (ready = true));

  const digits = $derived(whatsapp.replace(/\D/g, ''));
  const valid = $derived(name.trim().length >= 2 && digits.length >= 10 && digits.length <= 13);

  async function send(e: SubmitEvent) {
    e.preventDefault();
    if (!valid || phase === 'sending') return;
    phase = 'sending';
    error = '';
    try {
      const r = await fetch('/site/v1/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, whatsapp, segment: segment || undefined, website }),
      });
      if (r.status === 202) phase = 'sent';
      else {
        phase = 'error';
        error =
          r.status === 429
            ? 'Muitas tentativas por aqui. Espere uns minutos e tente de novo.'
            : r.status === 422
              ? 'Confira o nome e o WhatsApp, com o DDD.'
              : 'Não deu para enviar agora. Tente de novo daqui a pouco.';
      }
    } catch {
      phase = 'error';
      error = 'Sem conexão. Tente de novo daqui a pouco.';
    }
  }
</script>

{#if ready}
  <div class="callme {tone}">
    {#if phase === 'sent'}
      <p class="done" role="status">
        Recebemos, {name.trim().split(' ')[0]}. A gente te chama no WhatsApp para tirar as suas
        dúvidas.
      </p>
    {:else if !open}
      <button type="button" class="ask" onclick={() => (open = true)}>
        Prefere conversar antes? Deixe seu WhatsApp e a gente te chama.
      </button>
    {:else}
      <form onsubmit={send} novalidate>
        <p class="lead">Deixe seu WhatsApp e a gente te chama para tirar as dúvidas.</p>
        <div class="row">
          <label class="field">
            <span>Seu nome</span>
            <input type="text" autocomplete="name" maxlength="80" required bind:value={name} />
          </label>
          <label class="field">
            <span>WhatsApp com DDD</span>
            <input
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              maxlength="20"
              placeholder="(21) 99999-0000"
              required
              bind:value={whatsapp}
            />
          </label>
        </div>
        <label class="field">
          <span class="sr-only">O que você vende</span>
          <select bind:value={segment}>
            {#each SEGMENTS as [v, l] (v)}<option value={v}>{l}</option>{/each}
          </select>
        </label>
        <!-- people never see this one; bots fill it -->
        <label class="trap" aria-hidden="true">
          Site <input type="text" tabindex="-1" autocomplete="off" bind:value={website} />
        </label>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="actions">
          <button type="submit" class="go" disabled={!valid || phase === 'sending'}>
            {phase === 'sending' ? 'Enviando…' : 'Pedir para me chamarem'}
          </button>
          <span class="fine">Usamos o seu número só para responder a você.</span>
        </div>
      </form>
    {/if}
  </div>
{/if}

<style>
  .callme {
    width: min(100%, 520px);
    margin-inline: auto;
    text-align: left;
  }
  .ask {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 4px;
    border: 0;
    background: none;
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    color: var(--ink);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--spark) 70%, transparent);
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
    cursor: pointer;
    text-align: center;
    width: 100%;
    justify-content: center;
  }
  .after .ask {
    color: var(--after-ink);
  }
  .ask:hover {
    text-decoration-color: var(--spark);
  }
  form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 18px;
    border-radius: var(--radius-lg, 16px);
    background: var(--surface);
    box-shadow: var(--shadow-e1);
  }
  .after form {
    background: var(--after-card);
    box-shadow: inset 0 0 0 1px var(--after-line);
  }
  .lead {
    margin: 0;
    font-weight: 600;
    color: var(--ink);
  }
  .after .lead {
    color: var(--after-ink);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  @media (min-width: 560px) {
    .row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .field {
    display: grid;
    gap: 6px;
    font-size: 14px;
    color: var(--ink-muted);
  }
  .after .field {
    color: var(--after-muted);
  }
  input,
  select {
    min-width: 0;
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  .after input,
  .after select {
    border-color: var(--after-line);
    background: rgb(0 0 0 / 0.18);
    color: var(--after-ink);
  }
  .after select option {
    color: #0a100d;
  }
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--spark);
    outline-offset: 1px;
  }
  .trap {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }
  .go {
    min-height: 48px;
    padding: 0 20px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--primary);
    color: var(--on-primary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .after .go {
    background: var(--spark);
    color: #0a100d;
  }
  .go:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .fine {
    font-size: 13px;
    color: var(--ink-muted);
  }
  .after .fine {
    color: var(--after-muted);
  }
  .error {
    margin: 0;
    font-size: 14px;
    color: var(--danger, #b3261e);
  }
  .after .error {
    color: #ffb4a8;
  }
  .done {
    margin: 0;
    padding: 14px 16px;
    border-radius: var(--radius-md);
    background: var(--after-card);
    color: var(--after-ink);
    text-align: center;
  }
  .day .done {
    background: var(--surface);
    color: var(--ink);
  }
</style>
