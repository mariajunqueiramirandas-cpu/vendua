<script lang="ts">
  import Push from './Push.svelte';
  import Seg from './Seg.svelte';
  import { outcomeOf, type AnswerWho, type Contact } from './rules';

  // "Quem é esse número?" (ADR 0033, triage.ts): three chats on the store's own number, the
  // signals in their real order, and what follows: Duá answers, stays quiet, or asks the owner.
  type Key = 'luiz' | 'novo' | 'bia';
  let key = $state<Key>('bia');
  let who = $state<AnswerWho>('known_and_new');

  const CHATS: Record<
    Key,
    Contact & {
      name: string;
      prior: { me: boolean; text: string }[];
      fresh: string;
      reply: string;
    }
  > = {
    luiz: {
      name: 'Luiz',
      ordered: true,
      history: true,
      verdict: 'customer',
      prior: [
        { me: false, text: 'Chegou certinho, obrigado!' },
        { me: true, text: 'Que bom, Luiz! Bom apetite.' },
      ],
      fresh: 'Oi! Quero repetir o pedido da semana passada',
      reply:
        'Oi, Luiz! Sou o Duá, assistente virtual da Bolos da Nena. Vou montar igual ao último.',
    },
    novo: {
      name: 'Diego',
      ordered: false,
      history: false,
      verdict: 'customer',
      prior: [],
      fresh: 'Boa tarde! Vocês entregam no Centro?',
      reply: 'Boa tarde! Sou o Duá, assistente virtual da Bolos da Nena. Me conta o seu endereço?',
    },
    bia: {
      name: 'Bia',
      ordered: false,
      history: true,
      verdict: 'personal',
      prior: [
        { me: false, text: 'E aí, deu certo a feira de sábado?' },
        { me: true, text: 'Deu! Vendi tudo' },
        { me: false, text: 'Que orgulho, amiga!' },
      ],
      fresh: 'Domingo tem almoço lá em casa, bora?',
      reply: 'Oi, Bia! Sou o Duá, assistente virtual da Bolos da Nena. Quer ver o cardápio?',
    },
  };

  const c = $derived(CHATS[key]);
  const r = $derived(outcomeOf(c, who));
  const reads = $derived(!c.ordered && who === 'known_and_new');

  const SETTING: Record<AnswerWho, string> = {
    known_and_new: 'Clientes e números novos',
    known_only: 'Só quem já é cliente',
    everyone: 'Todo mundo',
  };
  const VERDICT = { personal: 'pessoal', customer: 'de cliente', unsure: 'não dá para saber' };
</script>

<figure class="numero" aria-labelledby="numero-cap">
  <div class="controls">
    <Seg
      legend="Quem escreveu"
      name="dcv-contact"
      min={110}
      bind:value={key}
      options={[
        { value: 'luiz', label: 'Luiz, já pediu' },
        { value: 'novo', label: 'número novo' },
        { value: 'bia', label: 'Bia, amiga' },
      ]}
    />
    <Seg
      legend="Quem o Duá atende"
      name="dcv-who"
      min={110}
      bind:value={who}
      options={[
        { value: 'known_and_new', label: 'Clientes e novos' },
        { value: 'known_only', label: 'Só clientes' },
        { value: 'everyone', label: 'Todo mundo' },
      ]}
    />
  </div>

  <div class="stage">
    <div class="chat">
      <p class="chat-head">{c.name}</p>
      {#if c.prior.length}
        <p class="sys">Conversa que já estava no seu WhatsApp</p>
        {#each c.prior as m, i (i)}
          <p class="b old" class:me={m.me}>{m.text}</p>
        {/each}
      {:else}
        <p class="sys">Primeira mensagem desse número</p>
      {/if}
      <p class="b new">{c.fresh}</p>
      {#if r.outcome === 'atende'}
        <p class="b me dua">{c.reply}</p>
      {/if}
    </div>

    <ol class="path" aria-live="polite">
      <li>
        <span class="q">Já fez pedido na loja?</span>
        <span class="a">{c.ordered ? 'Sim' : 'Não'}</span>
      </li>
      {#if !c.ordered}
        <li>
          <span class="q">O que você escolheu</span>
          <span class="a">{SETTING[who]}</span>
        </li>
      {/if}
      {#if reads}
        <li>
          <span class="q"
            >{c.history
              ? 'Lê as últimas 10 mensagens dessa conversa, e só dela'
              : 'Não há conversa anterior: lê a mensagem nova'}</span
          >
          <span class="a">{c.history ? `Conversa ${VERDICT[c.verdict]}` : 'Pergunta da loja'}</span>
        </li>
      {/if}
      <li class="end {r.outcome}">
        {#if r.outcome === 'atende'}
          <span class="q">O Duá responde</span>
          <span class="a"
            >porque {r.step}{#if who === 'everyone' && !c.ordered && c.verdict === 'personal'}. Por
              isso “Todo mundo” é para quando o número é só da loja{/if}.</span
          >
        {:else if r.outcome === 'quieto'}
          <span class="q">O Duá fica quieto</span>
          <span class="a"
            >Ninguém é avisado, e o que a {c.name} escreveu não fica guardado para a loja.</span
          >
        {:else}
          <span class="q">O Duá espera você decidir</span>
          <span class="a">porque {r.step}. O celular pergunta, no máximo uma vez por dia:</span>
        {/if}
      </li>
    </ol>
  </div>

  {#if r.outcome === 'pergunta'}
    <div class="push">
      <Push title="Novo contato no WhatsApp" body="{c.name} — é cliente?" action="abrir" />
    </div>
  {/if}

  <div class="cmds">
    <p class="cmd-head">
      Pelo seu WhatsApp: na conversa com a pessoa, mande só a palavra. A mensagem some na hora, para
      você e para ela.
    </p>
    <dl>
      <div>
        <dt>#cliente</dt>
        <dd>o Duá passa a atender esse contato.</dd>
      </div>
      <div>
        <dt>#pessoal</dt>
        <dd>o Duá não responde mais esse contato.</dd>
      </div>
      <div>
        <dt>#dua</dt>
        <dd>o Duá volta a responder agora, mesmo se você estava atendendo.</dd>
      </div>
    </dl>
  </div>

  <figcaption id="numero-cap">
    Simulação com a Bolos da Nena, na ordem real das perguntas do Duá. As conversas são exemplo; o
    que a leitura conclui em cada uma também.
  </figcaption>
</figure>

<style>
  figure.numero {
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
  figure.numero p {
    margin: 0;
  }
  .controls {
    display: grid;
    gap: 14px;
  }
  .stage {
    display: grid;
    gap: 16px;
  }
  @container (min-width: 560px) {
    .stage {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
    }
  }

  .chat {
    display: grid;
    gap: 6px;
    padding: 12px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }
  figure.numero p.chat-head {
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line);
    font: 600 0.9375rem/1.3 var(--font-display);
    color: var(--ink);
  }
  figure.numero p.sys {
    justify-self: center;
    margin: 4px 0;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  figure.numero p.b {
    max-width: 85%;
    justify-self: start;
    padding: 7px 11px;
    border-radius: 12px 12px 12px 4px;
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--line);
    font-size: 0.9375rem;
    line-height: 1.4;
    color: var(--ink);
  }
  figure.numero p.b.me {
    justify-self: end;
    border-radius: 12px 12px 4px 12px;
    background: var(--info-soft);
  }
  figure.numero p.b.old {
    opacity: 0.7;
  }
  figure.numero p.b.new {
    font-weight: 600;
  }
  figure.numero p.b.dua {
    background: var(--spark-soft);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--spark) 60%, transparent);
  }

  figure.numero ol.path {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: step;
  }
  .path li {
    position: relative;
    display: grid;
    gap: 2px;
    padding: 0 0 14px 34px;
    counter-increment: step;
    font-size: 0.9375rem;
    line-height: 1.45;
  }
  .path li::before {
    content: counter(step);
    position: absolute;
    left: 0;
    top: 0;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    font: 600 0.75rem/1 var(--font-display);
    color: var(--ink);
  }
  .path li:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 11px;
    top: 26px;
    bottom: 2px;
    width: 2px;
    background: var(--line);
  }
  .q {
    font-weight: 600;
    color: var(--ink);
  }
  .a {
    color: var(--ink-muted);
  }
  .path li.end {
    padding: 10px 12px 12px 46px;
    border-radius: 14px;
  }
  .path li.end::before {
    left: 18px;
    top: 15px;
    width: 14px;
    height: 14px;
    content: '';
  }
  .end.atende {
    background: var(--spark-soft);
  }
  .end.atende::before {
    background: var(--spark);
    box-shadow: none;
  }
  .end.quieto {
    background: var(--surface-sunken);
  }
  .end.pergunta {
    background: var(--warning-soft);
  }
  .end.pergunta::before {
    background: var(--warning);
    box-shadow: none;
  }

  .push {
    max-width: 360px;
  }

  .cmds {
    display: grid;
    gap: 10px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  figure.numero p.cmd-head {
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  dl {
    display: grid;
    gap: 8px;
    margin: 0;
  }
  dl div {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  dt {
    flex: none;
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    font-weight: 700;
    font-size: 0.875rem;
    color: var(--ink);
  }
  dd {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--ink);
  }

  figure.numero figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--ink-muted);
  }
</style>
