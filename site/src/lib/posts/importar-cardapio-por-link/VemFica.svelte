<script lang="ts">
  // What a link brings and what stays behind (docs/menu-import.md §1 goals and non-goals, §5, and
  // the store-level notes in copy.ts). The belt sorts them into two bins.
  const VEM: { group: string; items: string[] }[] = [
    {
      group: 'Do cardápio',
      items: [
        'categorias, na mesma ordem',
        'nomes e descrições',
        'preços, com o riscado da promoção',
        'fotos',
        'grupos de opções',
        'estoque e esgotados',
        'selos dos produtos',
      ],
    },
    {
      group: 'Da loja',
      items: [
        'nome, logo, capa e cor',
        'WhatsApp e Instagram',
        'endereço',
        'horários',
        'retirada, entrega e regiões',
        'pedido mínimo e tempo de preparo',
        'formas de pagamento e chave Pix',
      ],
    },
  ];
  const FICA: { why: string; items: string[] }[] = [
    {
      why: 'Não estão na página pública, e dados de cliente são pessoais',
      items: ['clientes', 'histórico de pedidos', 'saldo de pontos', 'avaliações'],
    },
    {
      why: 'Viram um aviso na prévia; os cupons você cria de novo em Marketing',
      items: ['cupons', 'cashback e indicação', 'mensagens automáticas', 'agendamento por horário'],
    },
  ];
</script>

<figure class="vf">
  <div class="bins">
    <div class="bin in">
      <p class="title">
        <span class="mark" aria-hidden="true"
          ><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" /></svg></span
        >Vem pelo link
      </p>
      {#each VEM as g (g.group)}
        <p class="grp">{g.group}</p>
        <ul>
          {#each g.items as it (it)}<li>{it}</li>{/each}
        </ul>
      {/each}
    </div>
    <div class="bin out">
      <p class="title">
        <span class="mark" aria-hidden="true"
          ><svg viewBox="0 0 24 24"><path d="M7 12h10" /></svg></span
        >Fica para trás
      </p>
      {#each FICA as g (g.why)}
        <p class="grp">{g.why}</p>
        <ul>
          {#each g.items as it (it)}<li>{it}</li>{/each}
        </ul>
      {/each}
    </div>
  </div>
  <figcaption>
    O que a importação traz hoje, pelo que está na página pública da loja. Cada configuração que não
    vem aparece como aviso na prévia, antes de você importar.
  </figcaption>
</figure>

<style>
  figure.vf {
    margin: 12px 0;
    display: grid;
    gap: 12px;
  }
  .bins {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 10px;
  }
  .bin {
    display: grid;
    align-content: start;
    gap: 6px;
    padding: 16px;
    border-radius: var(--radius-lg);
  }
  .bin.in {
    background: var(--success-soft);
  }
  .bin.out {
    border: 2px dashed var(--line-strong);
  }
  figure.vf p.title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    font: 600 1.125rem/1.3 var(--font-display);
    color: var(--ink);
  }
  .mark {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--success);
  }
  .out .mark {
    border-radius: 7px;
    background: var(--ink-muted);
  }
  .mark svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--surface);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  figure.vf p.grp {
    margin-top: 6px;
    font-size: 0.875rem;
    line-height: 1.35;
    font-weight: 650;
    color: color-mix(in srgb, var(--ink) 75%, var(--ink-muted));
  }
  figure.vf ul {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  figure.vf li {
    padding: 5px 10px;
    border-radius: 8px;
    background: var(--surface);
    font-size: 0.875rem;
    line-height: 1.3;
    color: var(--ink);
  }
  .out li {
    background: var(--surface-sunken);
    color: var(--ink-muted);
  }
  figure.vf figcaption {
    max-width: none;
    text-align: left;
    font-size: 0.875rem;
  }
</style>
