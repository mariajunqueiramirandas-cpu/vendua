// ESC/POS for 58/80 mm thermal printers (Epson, Elgin, Bematech in ESC/POS mode, the generic
// ones). Only the commands every one of them takes: init, code page, align, bold, size, feed,
// cut. Text goes out in the printer's code page; what that page lacks is folded to ASCII.

export type CodePage = 'cp850' | 'cp860' | 'ascii';
export type Paper = 58 | 80;

// bytes 0x80–0xFF of each page, from iconv
const UPPER: Record<Exclude<CodePage, 'ascii'>, string> = {
  cp850:
    'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø\u00d7ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨\u00b7¹³²■\u00a0',
  cp860:
    'ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòÚùÌÕÜ¢£Ù₧ÓáíóúñÑªº¿Ò¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙\u00b7√ⁿ²■\u00a0',
};

// ESC t n — the table numbers Epson-compatible firmware uses
const TABLE: Record<Exclude<CodePage, 'ascii'>, number> = { cp850: 2, cp860: 3 };

const maps = new Map<CodePage, Map<string, number>>();
function pageMap(cp: Exclude<CodePage, 'ascii'>): Map<string, number> {
  let m = maps.get(cp);
  if (!m) {
    m = new Map([...UPPER[cp]].map((ch, i) => [ch, 0x80 + i]));
    maps.set(cp, m);
  }
  return m;
}

const PUNCT: Record<string, string> = {
  '\u2013': '-',
  '\u2014': '-',
  '\u2212': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2026': '...',
  '\u2022': '*',
  '\u00b7': '-',
  '\u00a0': ' ',
  '\u202f': ' ',
  '\u00d7': 'x',
};

/** The bytes for `s` in code page `cp`; anything the page can't show is folded or dropped. */
export function encodeText(s: string, cp: CodePage): number[] {
  const page = cp === 'ascii' ? null : pageMap(cp);
  const out: number[] = [];
  for (const raw of s.normalize('NFC')) {
    const code = raw.codePointAt(0)!;
    if (code === 0x0a) {
      out.push(0x0a);
      continue;
    }
    if (code < 0x20 || code === 0x7f || code === 0xad) continue;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const hit = page?.get(raw);
    if (hit !== undefined) {
      out.push(hit);
      continue;
    }
    const sub = PUNCT[raw];
    if (sub) {
      for (const ch of sub) out.push(ch.charCodeAt(0));
      continue;
    }
    // á → a, Ç → C; emoji and the rest vanish rather than print as garbage
    const base = raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const ch of base) {
      const c = ch.codePointAt(0)!;
      if (c >= 0x20 && c < 0x7f) out.push(c);
    }
  }
  return out;
}

/** characters per line in font A at normal width */
export function columnsFor(paper: Paper): number {
  return paper === 58 ? 32 : 48;
}

/** Greedy word wrap at `width` columns; a word longer than a line is split. */
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

type Align = 'left' | 'center' | 'right';

/** A ticket under construction. Width-aware helpers wrap at the current text size. */
export class Receipt {
  private bytes: number[] = [];
  private wide = false;
  readonly columns: number;

  constructor(
    paper: Paper,
    private cp: CodePage,
  ) {
    this.columns = columnsFor(paper);
    this.raw(0x1b, 0x40);
    if (cp !== 'ascii') this.raw(0x1b, 0x74, TABLE[cp]);
  }

  raw(...b: number[]) {
    this.bytes.push(...b);
    return this;
  }

  align(a: Align) {
    return this.raw(0x1b, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  }

  bold(on: boolean) {
    return this.raw(0x1b, 0x45, on ? 1 : 0);
  }

  /** 1 = normal, 2 = double; width and height independently */
  size(width: 1 | 2, height: 1 | 2 = width) {
    this.wide = width === 2;
    return this.raw(0x1d, 0x21, ((width - 1) << 4) | (height - 1));
  }

  /** columns available at the current width */
  get width() {
    return this.wide ? Math.floor(this.columns / 2) : this.columns;
  }

  /** wrapped text, each line ended */
  text(s: string, indent = 0) {
    const pad = ' '.repeat(indent);
    for (const line of wrap(s, Math.max(1, this.width - indent))) {
      this.bytes.push(...encodeText(pad + line, this.cp), 0x0a);
    }
    return this;
  }

  /** `left ........ right` on one line; the left side wraps above when both don't fit */
  pair(left: string, right: string) {
    const room = this.width - right.length - 1;
    if (room < 4) return this.text(left).align('right').text(right).align('left');
    const lines = wrap(left, room);
    const last = lines.pop() ?? '';
    for (const l of lines) this.text(l);
    this.bytes.push(
      ...encodeText(
        last + ' '.repeat(Math.max(1, this.width - last.length - right.length)),
        this.cp,
      ),
      ...encodeText(right, this.cp),
      0x0a,
    );
    return this;
  }

  rule(ch = '-') {
    this.bytes.push(...encodeText(ch.repeat(this.width), this.cp), 0x0a);
    return this;
  }

  feed(lines = 1) {
    return this.raw(0x1b, 0x64, Math.max(0, Math.min(lines, 255)));
  }

  /** feed past the cutter, then a partial cut (GS V 66 n) */
  cut() {
    return this.raw(0x1d, 0x56, 0x42, 0x03);
  }

  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
