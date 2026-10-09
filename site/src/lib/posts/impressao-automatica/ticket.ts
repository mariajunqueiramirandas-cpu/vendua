// The kitchen ticket, laid out the way Core lays it out before it becomes ESC/POS bytes
// (packages/core/src/modules/printing/ticket.ts renderOrderTicket and escpos.ts Receipt): 32
// columns on 58 mm paper, 48 on 80 mm, half that in double width, the same greedy word wrap, the
// same code pages. Only the bytes are left out: the site draws the lines instead of printing them.

export type Paper = 58 | 80;
export type CodePage = 'cp850' | 'cp860' | 'ascii';

/** escpos.ts columnsFor: font A at normal width */
export const columnsFor = (paper: Paper) => (paper === 58 ? 32 : 48);

/** escpos.ts wrap: greedy, a word longer than a line is split */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}

// bytes 0x80–0xFF of each page (escpos.ts UPPER): what the printer can draw beyond ASCII
const UPPER: Record<Exclude<CodePage, 'ascii'>, string> = {
  cp850:
    'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ',
  cp860:
    'ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòÚùÌÕÜ¢£Ù₧ÓáíóúñÑªº¿Ò¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ',
};
const PAGES = {
  cp850: new Set(UPPER.cp850),
  cp860: new Set(UPPER.cp860),
};

const PUNCT: Record<string, string> = {
  '–': '-',
  '—': '-',
  '−': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  '•': '*',
  '·': '-',
  ' ': ' ',
  ' ': ' ',
  '×': 'x',
};

/** escpos.ts encodeText, read back: what the paper shows for `s` in code page `cp` */
export function onPaper(s: string, cp: CodePage): string {
  const page = cp === 'ascii' ? null : PAGES[cp];
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out += ch;
      continue;
    }
    if (page?.has(ch) && !PUNCT[ch]) {
      out += ch;
      continue;
    }
    if (PUNCT[ch]) {
      out += PUNCT[ch];
      continue;
    }
    out += ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  return out;
}

export interface Line {
  kind: 'text' | 'pair' | 'rule' | 'feed';
  text: string;
  right?: string;
  align: 'left' | 'center';
  bold: boolean;
  /** 1 = normal, 2 = double (escpos.ts size) */
  w: 1 | 2;
  h: 1 | 2;
  indent: number;
}

/** A ticket under construction, after escpos.ts Receipt: lines instead of bytes. */
class Sheet {
  lines: Line[] = [];
  private st = { align: 'left' as Line['align'], bold: false, w: 1 as 1 | 2, h: 1 as 1 | 2 };
  constructor(
    readonly columns: number,
    private cp: CodePage,
  ) {}
  align(a: Line['align']) {
    this.st.align = a;
    return this;
  }
  bold(on: boolean) {
    this.st.bold = on;
    return this;
  }
  size(w: 1 | 2, h: 1 | 2 = w) {
    this.st.w = w;
    this.st.h = h;
    return this;
  }
  get width() {
    return this.st.w === 2 ? Math.floor(this.columns / 2) : this.columns;
  }
  private push(l: Partial<Line> & Pick<Line, 'kind' | 'text'>) {
    this.lines.push({ ...this.st, indent: 0, ...l });
  }
  text(s: string, indent = 0) {
    for (const line of wrap(onPaper(s, this.cp), Math.max(1, this.width - indent)))
      this.push({ kind: 'text', text: line, indent });
    return this;
  }
  pair(left: string, right: string) {
    const r = onPaper(right, this.cp);
    const room = this.width - r.length - 1;
    const lines = wrap(onPaper(left, this.cp), room);
    const last = lines.pop() ?? '';
    for (const l of lines) this.push({ kind: 'text', text: l });
    this.push({ kind: 'pair', text: last, right: r });
    return this;
  }
  rule() {
    this.push({ kind: 'rule', text: '' });
    return this;
  }
  feed(n = 1) {
    for (let i = 0; i < n; i++) this.push({ kind: 'feed', text: '' });
    return this;
  }
}

// ── the example order ────────────────────────────────────────────────────────

export interface Item {
  qty: number;
  name: string;
  unitCents: number;
  choices: { name: string; cents: number }[];
  note?: string;
}

export interface Order {
  number: number;
  customer: string;
  mode: 'delivery' | 'pickup';
  address?: string;
  neighborhood?: string;
  placed: string;
  promise?: string;
  items: Item[];
  feeCents: number;
  notes?: string;
  payment: string;
  paymentLine: string;
}

/** money, pt-BR, from integer cents */
export const brl = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export const totalCents = (o: Order) =>
  o.items.reduce(
    (n, i) => n + i.qty * (i.unitCents + i.choices.reduce((c, x) => c + x.cents, 0)),
    0,
  ) + o.feeCents;

/** #29, Luiz, entrega (the site's facts): R$ 219,00 with the delivery fee. Example data. */
export const luiz: Order = {
  number: 29,
  customer: 'Luiz',
  mode: 'delivery',
  address: 'Rua das Acácias, 120',
  neighborhood: 'Centro',
  placed: '29/09 às 12:04',
  promise: '12:55–13:05',
  items: [
    {
      qty: 1,
      name: 'Bolo de laranja com calda',
      unitCents: 4600,
      choices: [{ name: 'Calda extra no pote', cents: 500 }],
    },
    { qty: 2, name: 'Bolo de milho cremoso', unitCents: 3600, choices: [] },
    {
      qty: 2,
      name: 'Bolo de chocolate molhadinho',
      unitCents: 3900,
      choices: [{ name: 'Cobertura de brigadeiro', cents: 500 }],
      note: 'um deles sem granulado',
    },
  ],
  feeCents: 800,
  notes: 'Tocar a campainha, o interfone está quebrado. É aniversário da minha mãe!',
  payment: 'Cartão na entrega',
  paymentLine: 'cobrar na entrega',
};

/** renderOrderTicket's layout, line for line (the phone line is left out of the example) */
export function renderTicket(
  o: Order,
  opts: { paper: Paper; codepage: CodePage; late?: string },
): Line[] {
  const r = new Sheet(columnsFor(opts.paper), opts.codepage);
  r.align('center');
  if (opts.late) {
    r.bold(true).text('*** IMPRESSÃO ATRASADA ***').bold(false);
    r.text(`na fila desde ${opts.late}`).feed(1);
  }
  r.text('Bolos da Nena');
  r.size(2).bold(true).text(`#${o.number}`).bold(false).size(1);
  r.size(1, 2)
    .bold(true)
    .text(o.mode === 'delivery' ? 'ENTREGA' : 'RETIRADA')
    .bold(false)
    .size(1);
  r.align('left').rule();
  r.bold(true).text(o.customer).bold(false);
  if (o.mode === 'delivery') r.text([o.address, o.neighborhood].filter(Boolean).join(' - '));
  r.text(`Pedido ${o.placed}`);
  if (o.promise) r.text(`Previsão: ${o.promise}`);
  r.rule();
  for (const i of o.items) {
    r.size(1, 2).bold(true).text(`${i.qty}x ${i.name}`).bold(false).size(1);
    for (const c of i.choices) r.text(`+ ${c.name}`, 3);
    if (i.note) r.bold(true).text(`OBS: ${i.note}`, 3).bold(false);
  }
  r.rule();
  if (o.notes) {
    r.bold(true).text('OBSERVAÇÃO:').bold(false);
    r.size(1, 2).text(o.notes).size(1);
    r.rule();
  }
  r.bold(true)
    .pair('TOTAL', brl(totalCents(o)))
    .bold(false);
  r.text(`${o.payment} - ${o.paymentLine}`);
  return r.lines;
}

/** printed height in normal lines: a double-height line takes two */
export const height = (lines: Line[]) => lines.reduce((n, l) => n + l.h, 0);
