// One Cliente oculto run at Bolos da Nena, scripted. The scenarios follow Core's recipe
// (packages/core/src/vendedor/cliente-oculto.ts, scenariosFor): orders from the store's own
// menu, then "entrega fora da área" and "pediu uma pessoa"; every shopper is told a hidden order
// and is called Júlia. `score` is Core's scoreOrder, line by line, with the reasons in words.

export interface TargetLine {
  name: string;
  qty: number;
  options: string[];
}

export interface Closed {
  lines: TargetLine[];
  mode: 'pickup' | 'delivery';
  payment: string;
}

export type Turn =
  | { who: 'julia' | 'dua'; text: string }
  | { who: 'card'; lines: { text: string; cents: number }[]; feeCents: number; payment: string }
  | { who: 'note'; text: string };

export interface Scenario {
  name: string;
  tone: string;
  expect: 'order' | 'handoff' | 'out_of_zone';
  check: string;
  target: Closed | null;
  /** what the test thread validated: the order Duá would have placed */
  closed: Closed | null;
  handedOff: boolean;
  talk: Turn[];
}

const PAY: Record<string, string> = {
  pix: 'Pix',
  cash: 'dinheiro, sem troco',
  card_on_delivery: 'cartão na entrega',
};
export const payWord = (m: string) => PAY[m] ?? m;
export const modeWord = (m: 'pickup' | 'delivery') => (m === 'delivery' ? 'entrega' : 'retirada');
export const lineWord = (l: TargetLine) =>
  `${l.qty}× ${l.name}${l.options.length ? ` com ${l.options.join(', ')}` : ''}`;

const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function score(sc: Scenario): { passed: boolean; why: string } {
  if (sc.expect === 'handoff')
    return sc.handedOff
      ? { passed: true, why: 'passou para a loja' }
      : { passed: false, why: 'não passou para a loja' };
  if (sc.expect === 'out_of_zone')
    return sc.closed
      ? { passed: false, why: 'fechou um pedido fora da área' }
      : { passed: true, why: 'não fechou pedido fora da área' };
  const o = sc.closed;
  if (!o)
    return {
      passed: false,
      why: sc.handedOff ? 'passou para a loja em vez de fechar' : 'não chegou a fechar o pedido',
    };
  const t = sc.target!;
  const key = (l: TargetLine) =>
    `${l.qty}×${fold(l.name)}[${l.options.map(fold).sort().join('|')}]`;
  if (t.lines.map(key).sort().join(',') !== o.lines.map(key).sort().join(','))
    return {
      passed: false,
      why: `esperado ${t.lines.map(lineWord).join(' + ')}; fechou ${o.lines.map(lineWord).join(' + ')}`,
    };
  if (o.mode !== t.mode)
    return { passed: false, why: `esperado ${modeWord(t.mode)}; fechou ${modeWord(o.mode)}` };
  if (o.payment !== t.payment)
    return {
      passed: false,
      why: `pagamento: esperado ${payWord(t.payment)}; fechou ${payWord(o.payment)}`,
    };
  return { passed: true, why: 'pedido igual ao escondido' };
}

const STOP: Turn = {
  who: 'note',
  text: 'Pedido de teste: confere como no checkout e para antes de existir.',
};
const FIM: Turn = { who: 'note', text: 'A Júlia respondeu FIM.' };
const HI = 'Oi! Sou o Duá, assistente virtual da Bolos da Nena.';

const cenoura = { name: 'Bolo de cenoura com brigadeiro', qty: 1, options: [] };
const fatiaC = { name: 'Fatia de cenoura com brigadeiro', qty: 2, options: [] };
const fatiaCh = { name: 'Fatia de chocolate', qty: 1, options: [] };
const choc = (o: string) => ({ name: 'Bolo de chocolate molhadinho', qty: 1, options: [o] });
const fuba = { name: 'Bolo de fubá com goiabada', qty: 1, options: [] };

export const RUN: Scenario[] = [
  {
    name: '1× Bolo de cenoura com brigadeiro, entrega',
    tone: 'direto, mensagens curtas',
    expect: 'order',
    check: 'pedido certo',
    target: { lines: [cenoura], mode: 'delivery', payment: 'pix' },
    closed: { lines: [cenoura], mode: 'delivery', payment: 'pix' },
    handedOff: false,
    talk: [
      { who: 'julia', text: 'oi, quero um bolo de cenoura com brigadeiro pra entregar' },
      { who: 'dua', text: `${HI} Anotei 1 Bolo de cenoura com brigadeiro. Qual é o endereço?` },
      { who: 'julia', text: 'Rua das Flores, 120, Centro. Pix' },
      {
        who: 'card',
        lines: [{ text: '1× Bolo de cenoura com brigadeiro', cents: 4500 }],
        feeCents: 800,
        payment: 'Pix',
      },
      { who: 'julia', text: 'sim' },
      STOP,
      FIM,
    ],
  },
  {
    name: '2× Fatia de cenoura com brigadeiro + 1× Fatia de chocolate, retirada',
    tone: 'falante, conta detalhes',
    expect: 'order',
    check: 'pedido certo',
    target: { lines: [fatiaC, fatiaCh], mode: 'pickup', payment: 'pix' },
    closed: { lines: [fatiaC, fatiaCh], mode: 'pickup', payment: 'pix' },
    handedOff: false,
    talk: [
      {
        who: 'julia',
        text: 'Oi! Vou passar aí depois do trabalho e queria levar umas fatias pra minha mãe e pra mim',
      },
      {
        who: 'dua',
        text: `${HI} Hoje tem fatia de cenoura com brigadeiro e de chocolate. Quais vão ser?`,
      },
      { who: 'julia', text: 'Duas de cenoura e uma de chocolate, minha mãe ama a de cenoura' },
      {
        who: 'card',
        lines: [
          { text: '2× Fatia de cenoura com brigadeiro', cents: 1800 },
          { text: '1× Fatia de chocolate', cents: 950 },
        ],
        feeCents: 0,
        payment: 'Pix',
      },
      { who: 'julia', text: 'sim' },
      STOP,
      FIM,
    ],
  },
  {
    name: '1× Bolo de chocolate molhadinho, entrega',
    tone: 'apressado, escreve com abreviações',
    expect: 'order',
    check: 'opções certas',
    target: { lines: [choc('Chocolate')], mode: 'delivery', payment: 'pix' },
    closed: { lines: [choc('Brigadeiro de chocolate')], mode: 'delivery', payment: 'pix' },
    handedOff: false,
    talk: [
      {
        who: 'julia',
        text: 'oi qro 1 bolo chocolate molhadinho c/ cobertura de chocolate, entrega',
      },
      {
        who: 'dua',
        text: `${HI} Anotei 1 Bolo de chocolate molhadinho com cobertura Brigadeiro de chocolate. Me passa o endereço?`,
      },
      { who: 'julia', text: 'av brasil 455, jd américa. pix' },
      {
        who: 'card',
        lines: [{ text: '1× Bolo de chocolate molhadinho (Brigadeiro de chocolate)', cents: 4800 }],
        feeCents: 800,
        payment: 'Pix',
      },
      { who: 'julia', text: 'sim' },
      STOP,
      FIM,
    ],
  },
  {
    name: '1× Bolo de fubá com goiabada, retirada',
    tone: 'educado, formal',
    expect: 'order',
    check: 'pedido certo',
    target: { lines: [fuba], mode: 'pickup', payment: 'cash' },
    closed: { lines: [fuba], mode: 'pickup', payment: 'cash' },
    handedOff: false,
    talk: [
      {
        who: 'julia',
        text: 'Boa tarde. Gostaria de encomendar um bolo de fubá com goiabada para retirar.',
      },
      { who: 'dua', text: `${HI} Claro. Vai pagar como na retirada?` },
      { who: 'julia', text: 'Em dinheiro, por favor. Não preciso de troco.' },
      {
        who: 'card',
        lines: [{ text: '1× Bolo de fubá com goiabada', cents: 3800 }],
        feeCents: 0,
        payment: 'dinheiro, sem troco',
      },
      { who: 'julia', text: 'sim' },
      STOP,
      FIM,
    ],
  },
  {
    name: 'entrega fora da área',
    tone: 'mora longe, no bairro Vila Inexistente do Norte',
    expect: 'out_of_zone',
    check: 'fora da área, explicou com calma',
    target: null,
    closed: null,
    handedOff: false,
    talk: [
      { who: 'julia', text: 'vcs entregam na Vila Inexistente do Norte?' },
      {
        who: 'dua',
        text: `${HI} Na Vila Inexistente do Norte a gente ainda não entrega. Se quiser, dá para retirar aqui na loja.`,
      },
      { who: 'julia', text: 'ah, é longe pra mim. obrigada' },
      FIM,
    ],
  },
  {
    name: 'pediu uma pessoa',
    tone: 'quer falar com uma pessoa sobre uma encomenda grande para uma festa',
    expect: 'handoff',
    check: 'chamou você quando pediram',
    target: null,
    closed: null,
    handedOff: true,
    talk: [
      {
        who: 'julia',
        text: 'Oi, queria falar com alguém da loja sobre uma encomenda grande pra uma festa',
      },
      { who: 'dua', text: `${HI} Vou chamar alguém da loja para falar com você sobre a festa.` },
      { who: 'note', text: 'Passou para a loja: aparece em Precisa de você.' },
      FIM,
    ],
  },
];

/** passed / total per check, the order checks first, as the admin lists them */
export function checks(run: Scenario[]) {
  const by = new Map<string, { passed: number; total: number }>();
  for (const sc of run) {
    const c = by.get(sc.check) ?? { passed: 0, total: 0 };
    c.total++;
    if (score(sc).passed) c.passed++;
    by.set(sc.check, c);
  }
  const rank = (k: string) => (k === 'pedido certo' || k === 'opções certas' ? 0 : 1);
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}
