<script lang="ts">
  import { onMount } from 'svelte';

  // The partners' application (/parceiros/): Core keeps it as 'pendente' for the team to approve
  // in the CRM (ADR 0043), first-party through the site's nginx. One per WhatsApp: a repeat
  // changes nothing. Needs JavaScript to send; without it the page asks for it.
  const KINDS: [string, string][] = [
    ['contador', 'Contabilidade'],
    ['fornecedor', 'Fornecedor (embalagens, insumos…)'],
    ['agencia', 'Agência ou social media'],
    ['consultor', 'Consultoria'],
    ['outro', 'Outro'],
  ];

  let ready = $state(false);
  let phase: 'idle' | 'sending' | 'sent' | 'error' = $state('idle');
  let error = $state('');
  let f = $state({ name: '', kind: 'contador', phone: '', email: '', city: '', note: '' });
  let website = $state('');
  onMount(() => (ready = true));

  const digits = $derived(f.phone.replace(/\D/g, ''));
  const valid = $derived(f.name.trim().length >= 2 && digits.length >= 10 && digits.length <= 13);

  async function send(e: SubmitEvent) {
    e.preventDefault();
    if (!valid || phase === 'sending') return;
    phase = 'sending';
    error = '';
    try {
      const r = await fetch('/site/v1/partners', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: f.name,
          kind: f.kind,
          phone: f.phone,
          email: f.email.trim() || undefined,
          city: f.city.trim() || undefined,
          note: f.note.trim() || undefined,
          website,
        }),
      });
      if (r.status === 202) phase = 'sent';
      else {
        phase = 'error';
        error =
          r.status === 429
            ? 'Muitas tentativas por aqui. Espere uns minutos e tente de novo.'
            : r.status === 422
              ? 'Confira o nome, o WhatsApp com DDD e o e-mail.'
              : 'Não deu para enviar agora. Tente de novo daqui a pouco.';
      }
    } catch {
      phase = 'error';
      error = 'Sem conexão. Tente de novo daqui a pouco.';
    }
  }
</script>

{#if !ready}
  <p class="nojs">Para se inscrever, abra esta página com o JavaScript ligado no navegador.</p>
{:else if phase === 'sent'}
  <div class="done" role="status">
    <p class="done-t">Inscrição recebida.</p>
    <p>
      A equipe da Venduá confere e te chama no WhatsApp com o seu link de parceiro. É por ele que as
      lojas que você indicar chegam até a gente.
    </p>
  </div>
{:else}
  <form class="partner-form" onsubmit={send} novalidate>
    <label class="field">
      <span>Seu nome ou o da empresa</span>
      <input type="text" autocomplete="organization" maxlength="80" required bind:value={f.name} />
    </label>
    <label class="field">
      <span>O que você faz</span>
      <select bind:value={f.kind}>
        {#each KINDS as [v, l] (v)}<option value={v}>{l}</option>{/each}
      </select>
    </label>
    <div class="row">
      <label class="field">
        <span>WhatsApp com DDD</span>
        <input
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          maxlength="20"
          placeholder="(21) 99999-0000"
          required
          bind:value={f.phone}
        />
      </label>
      <label class="field">
        <span>E-mail (opcional)</span>
        <input type="email" autocomplete="email" maxlength="120" bind:value={f.email} />
      </label>
    </div>
    <label class="field">
      <span>Cidade (opcional)</span>
      <input type="text" autocomplete="address-level2" maxlength="80" bind:value={f.city} />
    </label>
    <label class="field">
      <span>Quantas lojas de comida você atende? (opcional)</span>
      <textarea rows="3" maxlength="500" bind:value={f.note}></textarea>
    </label>
    <label class="trap" aria-hidden="true">
      Site <input type="text" tabindex="-1" autocomplete="off" bind:value={website} />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button type="submit" class="go" disabled={!valid || phase === 'sending'}>
      {phase === 'sending' ? 'Enviando…' : 'Quero ser parceiro'}
    </button>
  </form>
{/if}

<style>
  form,
  .done {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    padding: 22px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-e1);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
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
  input,
  select,
  textarea {
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
  textarea {
    padding-block: 12px;
    resize: vertical;
  }
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
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
  .go {
    justify-self: start;
    min-height: 52px;
    padding: 0 24px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--primary);
    color: var(--on-primary);
    font: inherit;
    font-weight: 600;
    box-shadow: var(--shadow-e1);
    cursor: pointer;
  }
  .go:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .error {
    margin: 0;
    font-size: 14px;
    color: var(--danger);
  }
  .done-t {
    font: 600 1.25rem/1.3 var(--font-display);
    color: var(--ink);
  }
  .done p {
    margin: 0;
  }
  .nojs {
    color: var(--ink-muted);
  }
</style>
