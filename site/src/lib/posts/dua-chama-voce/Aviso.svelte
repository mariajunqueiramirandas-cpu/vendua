<script lang="ts">
  import Push from './Push.svelte';
  import Seg from './Seg.svelte';
  import { REPINGS } from './rules';

  // What happens after "vou chamar alguém da loja", minute by minute (admin/workers.ts): the push,
  // the re-pings at 5 and 15 min, the one WhatsApp when no push reached a phone, and how an
  // answer ends all of it.
  let answer = $state<'never' | '3' | '10'>('never');
  let phone = $state<'ok' | 'off'>('ok');

  const at = $derived(answer === 'never' ? Infinity : Number(answer));
  const preview = '“Cadê meu pedido? Tá demorando muito”';
  const title = 'Luiz precisa de você · reclamação';
  const stamp = (m: number) => `14h${String(12 + m).padStart(2, '0')}`;
</script>

<figure class="aviso" aria-labelledby="aviso-cap">
  <div class="controls">
    <Seg
      legend="Seu celular"
      name="dcv-phone"
      min={130}
      bind:value={phone}
      options={[
        { value: 'ok', label: 'recebe os avisos' },
        { value: 'off', label: 'está sem avisos' },
      ]}
    />
    <Seg
      legend="Você responde o Luiz"
      name="dcv-answer"
      min={84}
      bind:value={answer}
      options={[
        { value: '3', label: 'aos 3 min' },
        { value: '10', label: 'aos 10 min' },
        { value: 'never', label: 'ainda não' },
      ]}
    />
  </div>

  <ol class="rail" aria-live="polite">
    <li class="step">
      <span class="t">0 min</span>
      <div class="what">
        <p class="say">
          O Duá avisa o Luiz: “Vou chamar alguém da loja para te ajudar com isso.” A conversa vai
          para <strong>Precisa de você</strong>, no app.
        </p>
        <Push
          {title}
          body="{preview} · esperando há 1 min"
          when={stamp(0)}
          action="assumir"
          muted={phone === 'off'}
        />
        {#if phone === 'off'}<p class="miss">Esse aviso não chegou em nenhum aparelho.</p>{/if}
      </div>
    </li>

    {#if at === 3}
      <li class="step done">
        <span class="t">3 min</span>
        <div class="what">
          <p class="say"><strong>Você responde.</strong> Os avisos param aqui.</p>
        </div>
      </li>
    {/if}

    <li class="step" class:skip={at < REPINGS[0]}>
      <span class="t">{REPINGS[0]} min</span>
      <div class="what">
        {#if at < REPINGS[0]}
          <p class="say">Novo aviso: não precisou.</p>
        {:else}
          <p class="say">Ninguém respondeu: o celular avisa de novo.</p>
          <Push
            {title}
            body="{preview} · esperando há {REPINGS[0]} min"
            when={stamp(REPINGS[0])}
            action="assumir"
            muted={phone === 'off'}
          />
          {#if phone === 'off'}
            <p class="say">
              Como nenhum aviso chegou, a dona e quem gerencia a loja recebem uma mensagem no
              WhatsApp, uma vez:
            </p>
            <p class="wa">
              Venduá: um cliente está esperando por você numa conversa do Duá da Bolos da Nena há
              {REPINGS[0]} min, e o aviso não chegou em nenhum aparelho. Abra o painel da Venduá para
              responder.
            </p>
          {/if}
        {/if}
      </div>
    </li>

    {#if at === 10}
      <li class="step done">
        <span class="t">10 min</span>
        <div class="what">
          <p class="say"><strong>Você responde.</strong> Os avisos param aqui.</p>
        </div>
      </li>
    {/if}

    <li class="step" class:skip={at < REPINGS[1]}>
      <span class="t">{REPINGS[1]} min</span>
      <div class="what">
        {#if at < REPINGS[1]}
          <p class="say">Último aviso: não precisou.</p>
        {:else}
          <p class="say">O último aviso.</p>
          <Push
            {title}
            body="{preview} · esperando há {REPINGS[1]} min"
            when={stamp(REPINGS[1])}
            action="assumir"
            muted={phone === 'off'}
          />
          <p class="say">Depois disso o celular para de insistir.</p>
        {/if}
      </div>
    </li>
  </ol>

  <figcaption id="aviso-cap">
    Simulação com a Bolos da Nena. Os tempos, a mensagem do Duá, o texto dos avisos e a mensagem no
    WhatsApp são os do sistema; o Luiz e os horários são exemplo.
  </figcaption>
</figure>

<style>
  figure.aviso {
    margin: 12px 0;
    display: grid;
    gap: 20px;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow:
      0 0 0 1px var(--line),
      var(--shadow-e1);
    container-type: inline-size;
  }
  .controls {
    display: grid;
    gap: 14px;
  }
  @container (min-width: 560px) {
    .controls {
      grid-template-columns: 1fr 1fr;
    }
  }

  figure.aviso ol.rail {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .step {
    position: relative;
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 14px;
    padding-bottom: 22px;
  }
  .step:last-child {
    padding-bottom: 0;
  }
  /* the rail and its stops */
  .step::before {
    content: '';
    position: absolute;
    left: 71px;
    top: 10px;
    bottom: -10px;
    width: 2px;
    background: var(--line-strong);
  }
  .step:last-child::before {
    display: none;
  }
  .step::after {
    content: '';
    position: absolute;
    left: 66px;
    top: 4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: inset 0 0 0 2.5px var(--warning);
  }
  .step.done::after {
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-soft);
  }
  .step.skip::after {
    box-shadow: inset 0 0 0 2px var(--ink-faint);
  }
  .t {
    font: 600 0.9375rem/1.3 var(--font-display);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    text-align: right;
    padding-right: 8px;
  }
  .what {
    display: grid;
    gap: 10px;
    padding-left: 18px;
    min-width: 0;
  }
  .skip .t,
  .skip .what {
    opacity: 0.6;
  }
  figure.aviso p {
    margin: 0;
  }
  figure.aviso p.say {
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  figure.aviso p.say strong {
    color: var(--ink);
  }
  .done p.say {
    color: var(--success);
  }
  figure.aviso p.miss {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--danger);
  }
  figure.aviso p.wa {
    padding: 10px 12px;
    border-radius: 12px 12px 12px 4px;
    background: var(--success-soft);
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink);
  }

  figure.aviso figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
</style>
