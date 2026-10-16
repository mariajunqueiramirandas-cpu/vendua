import type { PlanFeature, Role } from '../lib/api.ts';

// Search answers "where is X?" too: every screen and the settings people look for, with the
// words a merchant would type for it (no accents, any order). A match shows above orders,
// products and customers.

export interface ScreenEntry {
  to: string;
  label: string;
  /** where it lives, for the line under the label */
  where: string;
  words: string;
  min: Role;
  feature?: PlanFeature;
}

export const SCREENS: ScreenEntry[] = [
  {
    to: '/',
    label: 'Início',
    where: 'o resumo do dia',
    words: 'inicio resumo hoje',
    min: 'attendant',
  },
  {
    to: '/pedidos',
    label: 'Pedidos',
    where: 'os pedidos de agora',
    words: 'pedidos aceitar quadro',
    min: 'attendant',
  },
  {
    to: '/pedidos/agendados',
    label: 'Encomendas marcadas',
    where: 'Pedidos',
    words: 'encomendas agendados calendario data bolo festa',
    min: 'attendant',
  },
  {
    to: '/pedidos/historico',
    label: 'Histórico de pedidos',
    where: 'Pedidos',
    words: 'historico antigos pedidos passados planilha',
    min: 'attendant',
  },
  {
    to: '/pdv',
    label: 'PDV',
    where: 'venda no balcão',
    words: 'pdv balcao venda caixa mesa comanda',
    min: 'attendant',
    feature: 'pdv',
  },
  {
    to: '/cozinha',
    label: 'Cozinha',
    where: 'a tela da cozinha',
    words: 'cozinha kds tela preparo',
    min: 'attendant',
    feature: 'kds',
  },
  {
    to: '/cardapio',
    label: 'Cardápio',
    where: 'produtos e categorias',
    words: 'cardapio produtos categorias preco foto',
    min: 'manager',
  },
  {
    to: '/cardapio/estoque',
    label: 'Estoque',
    where: 'Cardápio',
    words: 'estoque repor quantidade compras custo',
    min: 'manager',
  },
  {
    to: '/cardapio/festa',
    label: 'Calculadora de festa',
    where: 'Cardápio',
    words: 'festa calculadora aniversario pessoas convidados',
    min: 'manager',
  },
  {
    to: '/cardapio/planos',
    label: 'Planos semanais',
    where: 'Cardápio',
    words: 'planos semanais assinatura cesta semana',
    min: 'manager',
  },
  {
    to: '/cardapio/importar',
    label: 'Importar cardápio',
    where: 'Cardápio',
    words: 'importar ifood anota ai cardapio trazer',
    min: 'manager',
  },
  {
    to: '/loja',
    label: 'Loja',
    where: 'todos os ajustes da loja',
    words: 'loja configuracoes configurar ajustes opcoes',
    min: 'manager',
  },
  {
    to: '/loja/horarios',
    label: 'Horários',
    where: 'Loja',
    words: 'horarios hora abrir fechar aberta fechada feriado dia especial mensagem recado pausa',
    min: 'manager',
  },
  {
    to: '/loja/entrega',
    label: 'Entrega e retirada',
    where: 'Loja',
    words: 'entrega retirada frete taxa bairro area raio mapa distancia km pedido minimo motoboy',
    min: 'manager',
  },
  {
    to: '/loja/preparo',
    label: 'Tempo de preparo',
    where: 'Loja',
    words: 'tempo preparo aceite demora muitos pedidos freio fila cozinha cheia',
    min: 'manager',
  },
  {
    to: '/loja/encomendas',
    label: 'Como a loja aceita encomendas',
    where: 'Loja',
    words: 'encomendas antecedencia limite dia sinal vespera lembrete',
    min: 'manager',
  },
  {
    to: '/loja/perfil',
    label: 'Perfil da loja',
    where: 'Loja',
    words: 'perfil nome logo descricao whatsapp instagram email endereco cep cidade contato',
    min: 'manager',
  },
  {
    to: '/loja/site',
    label: 'Site e endereço',
    where: 'Loja',
    words: 'site endereco link url dominio proprio sob medida',
    min: 'manager',
  },
  {
    to: '/aparencia',
    label: 'Aparência',
    where: 'Loja',
    words: 'aparencia pagina cores fotos visual tema loja layout banner',
    min: 'manager',
  },
  {
    to: '/pagamentos',
    label: 'Pagamentos',
    where: 'o dinheiro que entrou',
    words: 'pagamentos recebimentos pix conferir recebi dinheiro extrato mes',
    min: 'manager',
  },
  {
    to: '/loja/pagamentos',
    label: 'Formas de pagamento',
    where: 'Loja',
    words: 'formas pagamento pix chave mercado pago cartao dinheiro vale refeicao taxa desconto',
    min: 'manager',
  },
  {
    to: '/vendedor',
    label: 'Duá',
    where: 'o vendedor no WhatsApp',
    words: 'dua vendedor ia whatsapp conversas atendimento',
    min: 'attendant',
    feature: 'vendedor',
  },
  {
    to: '/clientes',
    label: 'Clientes',
    where: 'quem compra de você',
    words: 'clientes telefone lgpd',
    min: 'manager',
  },
  {
    to: '/marketing',
    label: 'Cupons e fidelidade',
    where: 'Marketing › Ofertas',
    words: 'cupom cupons desconto promocao fidelidade selo premio aviso faixa',
    min: 'manager',
  },
  {
    to: '/marketing/divulgar',
    label: 'Divulgar a loja',
    where: 'Marketing',
    words: 'divulgar compartilhar link qr code status dia cartao sacola instagram',
    min: 'manager',
  },
  {
    to: '/marketing/lembretes',
    label: 'Lembretes',
    where: 'Marketing',
    words: 'lembrete sacola abandonada pedido de sempre lista espera recuperar',
    min: 'manager',
  },
  {
    to: '/relatorios',
    label: 'Relatórios',
    where: 'vendas e horários',
    words: 'relatorios vendas faturamento graficos mais vendidos planilha',
    min: 'manager',
  },
  {
    to: '/whatsapp',
    label: 'WhatsApp da loja',
    where: 'Loja',
    words: 'whatsapp conectar numero avisos clientes mensagens',
    min: 'manager',
  },
  {
    to: '/impressoras',
    label: 'Impressoras',
    where: 'Loja',
    words: 'impressora imprimir comanda termica',
    min: 'manager',
    feature: 'printing',
  },
  {
    to: '/equipe',
    label: 'Equipe',
    where: 'Loja',
    words: 'equipe pessoas funcionario gerente atendente convite acesso',
    min: 'manager',
  },
  {
    to: '/equipe/atividade',
    label: 'Quem mudou o quê',
    where: 'Loja › Equipe',
    words: 'atividade historico mudancas quem mudou',
    min: 'manager',
  },
  {
    to: '/conta',
    label: 'Conta e plano',
    where: 'Loja',
    words: 'conta plano assinatura fatura cobranca cancelar indique ganhe',
    min: 'owner',
  },
  {
    to: '/perfil',
    label: 'Meu perfil',
    where: 'você',
    words: 'perfil nome email tema escuro claro noite',
    min: 'attendant',
  },
  {
    to: '/perfil/avisos',
    label: 'Avisos e som',
    where: 'Meu perfil',
    words: 'avisos notificacoes som volume celular push alerta',
    min: 'attendant',
  },
  {
    to: '/perfil/aparelhos',
    label: 'Aparelhos conectados',
    where: 'Meu perfil',
    words: 'aparelhos sair sessao celular conectados',
    min: 'attendant',
  },
  {
    to: '/ajuda',
    label: 'Ajuda',
    where: 'fale com a Venduá',
    words: 'ajuda suporte duvida',
    min: 'attendant',
  },
];

export const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

/** a word of `text` starts with `t` ("hora" finds "Horários", "ana" doesn't find "semanais") */
export const startsWord = (text: string, t: string) =>
  text.split(/\s+/).some((w) => w.startsWith(t));

/** Screens whose name or words hold every word typed, best first (a name match leads). */
export function findScreens(q: string, allowed: (e: ScreenEntry) => boolean, max = 4) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return SCREENS.filter(allowed)
    .map((e) => {
      const name = fold(e.label);
      const hay = `${name} ${e.words}`.split(/\s+/);
      if (!terms.every((t) => hay.some((w) => w.startsWith(t)))) return null;
      return { e, score: terms.filter((t) => startsWord(name, t)).length };
    })
    .filter((x): x is { e: ScreenEntry; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.e);
}
