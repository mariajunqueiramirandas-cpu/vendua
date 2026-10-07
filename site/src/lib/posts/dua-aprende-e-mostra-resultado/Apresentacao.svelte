<script lang="ts">
  import Dua from '$lib/components/Dua.svelte';

  // "Como ele se apresenta" from Configurar: the three tones and the disclosure switch, with the
  // admin's own preview sentences (Settings.parts.tsx greetingFor, around Core's `introduction`).
  type Tone = 'relaxed' | 'balanced' | 'formal';
  const TONES: { value: Tone; label: string }[] = [
    { value: 'relaxed', label: 'descontraído' },
    { value: 'balanced', label: 'equilibrado' },
    { value: 'formal', label: 'formal' },
  ];
  let tone = $state<Tone>('balanced');
  let disclose = $state(true);

  const intro = $derived(
    disclose ? 'o Duá, assistente virtual da Bolos da Nena' : 'o Duá, da Bolos da Nena',
  );
  const line = $derived(
    tone === 'relaxed'
      ? `Oi, Bia! Aqui é ${intro}. Bora pedir hoje?`
      : tone === 'formal'
        ? `Boa tarde, Bia. Sou ${intro}. Como posso ajudar com o seu pedido?`
        : `Boa tarde, Bia! Sou ${intro}. O que vai ser hoje?`,
  );
</script>

<figure class="tom" aria-labelledby="tom-cap">
  <div class="sheet">
    <div class="controls">
      <div class="tones" role="group" aria-label="Jeito de falar">
        {#each TONES as t (t.value)}
          <button type="button" aria-pressed={tone === t.value} onclick={() => (tone = t.value)}
            >{t.label}</button
          >
        {/each}
      </div>
      <label class="switch">
        <input type="checkbox" bind:checked={disclose} />
        <span class="track" aria-hidden="true"></span>
        Dizer que é assistente virtual
      </label>
    </div>
    <div class="chat" aria-live="polite">
      <Dua pose="avatar-ola" size={44} />
      <p class="bubble">{line}</p>
    </div>
    <p class="note">
      {disclose
        ? 'Ele se apresenta como assistente virtual da loja.'
        : 'Ele se apresenta só como o Duá da loja, nunca diz que é uma pessoa e conta a verdade se perguntarem.'}
    </p>
  </div>
  <figcaption id="tom-cap">
    A prévia do app, com a Bolos da Nena. Na conversa de verdade as palavras são dele, no jeito que
    você escolheu.
  </figcaption>
</figure>

<style>
  .tom {
    margin: 16px 0;
    display: grid;
    gap: 12px;
  }
  .sheet {
    display: grid;
    gap: 16px;
    padding: 20px 18px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
  }
  .tones {
    display: grid;
    grid-template-columns: repeat(3, auto);
    padding: 4px;
    gap: 4px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  @media (max-width: 359px) {
    .tones {
      grid-template-columns: minmax(0, 1fr);
      border-radius: 22px;
    }
  }
  .tones button {
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ink-muted);
    font: 600 0.875rem/1 var(--font-sans);
    cursor: pointer;
  }
  .tones button[aria-pressed='true'] {
    background: var(--primary);
    color: var(--on-primary);
  }
  .tones button:focus-visible,
  .switch input:focus-visible + .track {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
  }
  .switch input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .track {
    position: relative;
    width: 44px;
    height: 26px;
    flex: none;
    border-radius: 999px;
    background: var(--line-strong);
    transition: background var(--duration-quick) var(--ease-soft);
  }
  .track::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow-e1);
    transition: transform var(--duration-quick) var(--ease-soft);
  }
  .switch input:checked + .track {
    background: var(--success);
  }
  .switch input:checked + .track::after {
    transform: translateX(18px);
  }
  .chat {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }
  .chat :global(img) {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--spark-soft);
  }
  figure.tom p {
    margin: 0;
    color: var(--ink);
  }
  figure.tom p.bubble {
    max-width: 30rem;
    padding: 10px 14px;
    border-radius: 18px 18px 18px 6px;
    background: var(--surface);
    box-shadow: var(--shadow-e1);
    font-size: 1rem;
    line-height: 1.45;
  }
  figure.tom p.note {
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  figure.tom figcaption {
    max-width: none;
    text-align: left;
  }
  @media (prefers-reduced-motion: reduce) {
    .track,
    .track::after {
      transition: none;
    }
  }
</style>
