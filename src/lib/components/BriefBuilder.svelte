<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { site } from '$lib/content/site';
  let ready = $state(false);
  let step = $state(1);
  let segment = $state('');
  let channels: string[] = $state([]);
  let goal = $state('');
  let detail = $state('');
  let message = $state('');
  let error = $state('');
  let copyStatus = $state('');
  let form = $state<HTMLFormElement>();
  let heading = $state<HTMLHeadingElement>();
  let summary = $state<HTMLTextAreaElement>();
  const questions = [
    'O que você vende?',
    'Como recebe pedidos hoje?',
    'O que quer facilitar primeiro?',
  ];
  const options = [
    ['Confeitaria', 'Alimentação e delivery', 'Outros produtos', 'Serviços'],
    ['WhatsApp', 'Instagram', 'Site', 'Presencial', 'Outro'],
    [
      'Apresentar meus produtos',
      'Receber pedidos',
      'Organizar a operação',
      'Apoiar o atendimento',
      'Ainda estou entendendo',
    ],
  ];
  let lastGenerated = '';
  onMount(() => {
    ready = true;
  });
  async function next(event: SubmitEvent) {
    event.preventDefault();
    error =
      step === 1 && !segment
        ? 'Selecione o que você vende para continuar.'
        : step === 2 && !channels.length
          ? 'Selecione pelo menos um canal para continuar.'
          : step === 3 && !goal
            ? 'Selecione o que quer facilitar para continuar.'
            : detail.length > 500
              ? 'Use até 500 caracteres no detalhe.'
              : '';
    if (error) {
      await tick();
      form?.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    if (step === 3) {
      const generated = `Oi, Vini! Conheci a Venduá pelo site. Meu negócio é de ${segment.toLocaleLowerCase('pt-BR')}, recebo pedidos por ${channels.join(', ')} e quero facilitar ${goal.toLocaleLowerCase('pt-BR')}. ${detail.trim() ? detail.trim() + ' ' : ''}Podemos conversar?`;
      if (generated !== lastGenerated) {
        message = generated;
        lastGenerated = generated;
      }
    }
    step++;
    copyStatus = '';
    await tick();
    heading?.focus();
  }
  async function back() {
    step--;
    error = '';
    copyStatus = '';
    await tick();
    heading?.focus();
  }
  async function copy() {
    copyStatus = '';
    await tick();
    try {
      await navigator.clipboard.writeText(message);
      copyStatus = 'Mensagem copiada. Agora você pode colar no direct.';
    } catch {
      copyStatus = 'Não foi possível copiar automaticamente. Selecione e copie o texto abaixo.';
      summary?.focus();
      summary?.select();
    }
  }
</script>

{#if ready}
  <div class="brief-card">
    <div class="progress-label">
      <span>Passo {step} de 4</span><span>{step === 4 ? 'Sua mensagem' : 'Sobre o negócio'}</span>
    </div>
    <div class="progress-track" aria-hidden="true">
      {#each [1, 2, 3, 4] as item}<span class:complete={step >= item}></span>{/each}
    </div>
    <h2 tabindex="-1" bind:this={heading}>
      {step < 4 ? questions[step - 1] : 'Tudo pronto para conversar.'}
    </h2>
    {#if step < 4}
      <form bind:this={form} onsubmit={next} novalidate>
        <fieldset aria-describedby={error ? 'brief-error' : undefined}>
          <legend class="sr-only">{questions[step - 1]}</legend>
          <p class="fine">
            {step === 2 ? 'Você pode escolher mais de uma opção.' : 'Escolha uma opção.'}
          </p>
          <div class="options">
            {#each options[step - 1] as option}
              <label class="option">
                {#if step === 1}<input
                    type="radio"
                    name="segment"
                    value={option}
                    bind:group={segment}
                    aria-describedby={error ? 'brief-error' : undefined}
                  />
                {:else if step === 2}<input
                    type="checkbox"
                    name="channels"
                    value={option}
                    bind:group={channels}
                    aria-describedby={error ? 'brief-error' : undefined}
                  />
                {:else}<input
                    type="radio"
                    name="goal"
                    value={option}
                    bind:group={goal}
                    aria-describedby={error ? 'brief-error' : undefined}
                  />{/if}
                <span>{option}</span>
              </label>
            {/each}
          </div>
          {#if error}<p class="field-error" id="brief-error">⚠ {error}</p>{/if}
        </fieldset>
        {#if step === 3}<label class="detail-label" for="detail"
            >Quer acrescentar algum detalhe? <span class="fine">(opcional)</span></label
          ><textarea
            id="detail"
            bind:value={detail}
            maxlength="500"
            rows="4"
            aria-describedby="detail-hint"></textarea>
          <p class="fine" id="detail-hint">
            {detail.length}/500 caracteres. Evite incluir dados pessoais.
          </p>{/if}
        <div class="actions brief-actions">
          {#if step > 1}<button type="button" class="button outline" onclick={back}>Voltar</button
            >{/if}<button type="submit" class="button"
            >{step === 3 ? 'Revisar mensagem' : 'Continuar'}
            <span aria-hidden="true">→</span></button
          >
        </div>
      </form>
    {:else}
      <label for="message">Revise e edite sua mensagem antes de copiar.</label><textarea
        id="message"
        bind:this={summary}
        bind:value={message}
        oninput={() => (copyStatus = '')}
        rows="8"></textarea>
      <p class="copy-status" role="status">{copyStatus}</p>
      <div class="actions">
        <button class="button" onclick={copy}
          >Copiar mensagem <span aria-hidden="true">↗</span></button
        ><a class="button outline" href={site.instagramUrl} target="_blank" rel="noreferrer"
          >Abrir Instagram <span class="sr-only">(nova aba)</span><span aria-hidden="true">↗</span
          ></a
        >
      </div>
      <p class="fine">
        Depois de copiar, abra o Instagram e cole a mensagem no direct. Nada é enviado
        automaticamente.
      </p>
      <button class="text-button" onclick={back}>← Voltar</button>
    {/if}
  </div>
  <p class="fine local-note">
    Suas respostas ficam apenas nesta página. Ao atualizar ou sair, elas são apagadas.
  </p>
{:else}<p class="brief-card">
    O assistente de mensagem precisa de JavaScript. Para conversar, acesse o Instagram pelo link
    abaixo e conte o que você vende, como recebe pedidos e o que quer facilitar.
  </p>{/if}
<div class="direct-contact">
  <a class="text-link" href={site.instagramUrl}>Prefiro falar direto no Instagram ↗</a>
  <p class="fine">@vendua.digital · O Instagram pode solicitar login.</p>
</div>
