import { readFileSync } from 'node:fs';

/** Strips comments but keeps line structure so locations stay right. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

export function lines(file: string): { n: number; text: string }[] {
  return stripComments(readFileSync(file, 'utf8'))
    .split('\n')
    .map((text, i) => ({ n: i + 1, text }));
}

/** 1-based line of a character offset. */
export function lineOf(src: string, index: number): number {
  let n = 1;
  for (let i = src.indexOf('\n'); i !== -1 && i < index; i = src.indexOf('\n', i + 1)) n++;
  return n;
}

export interface Literal {
  /** text between the quotes, `${…}` included for templates */
  raw: string;
  quote: "'" | '"' | '`';
  /** offsets of the opening quote and one past the closing quote */
  start: number;
  end: number;
  line: number;
}

const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+']);
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete']);

/**
 * String and template literals of comment-stripped source, nested templates included.
 * Not a parser: regex literals are skipped by the usual previous-token guess, and a quote
 * with no partner on its line (an apostrophe in JSX text) is ignored.
 */
export function literals(src: string): Literal[] {
  const out: Literal[] = [];
  const n = src.length;
  const starts: number[] = [0];
  for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineAt = (idx: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  // returns the offset after the template's closing backtick (or n when unterminated)
  const template = (from: number): number => {
    let i = from + 1;
    while (i < n) {
      const c = src[i]!;
      if (c === '\\') i += 2;
      else if (c === '`') {
        out.push({
          raw: src.slice(from + 1, i),
          quote: '`',
          start: from,
          end: i + 1,
          line: lineAt(from),
        });
        return i + 1;
      } else if (c === '$' && src[i + 1] === '{') i = code(i + 2, true);
      else i++;
    }
    return n;
  };

  // scans code; with `inExpr` stops after the `}` that closes a template expression
  const code = (from: number, inExpr: boolean): number => {
    let i = from;
    let depth = 0;
    let prev = '';
    let prevWord = '';
    while (i < n) {
      const c = src[i]!;
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === '`') {
        i = template(i);
        prev = '`';
        continue;
      }
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        if (src[j] === c) {
          out.push({
            raw: src.slice(i + 1, j),
            quote: c,
            start: i,
            end: j + 1,
            line: lineAt(i),
          });
          i = j + 1;
        } else i++;
        prev = c;
        continue;
      }
      if (c === '/' && (REGEX_AFTER.has(prev) || REGEX_AFTER_WORD.has(prevWord))) {
        let j = i + 1;
        let cls = false;
        while (j < n && src[j] !== '\n' && (cls || src[j] !== '/')) {
          if (src[j] === '\\') j++;
          else if (src[j] === '[') cls = true;
          else if (src[j] === ']') cls = false;
          j++;
        }
        if (src[j] === '/') {
          i = j + 1;
          while (/[a-z]/i.test(src[i] ?? '')) i++;
          prev = ')';
          prevWord = '';
          continue;
        }
      }
      if (c === '{') depth++;
      else if (c === '}') {
        if (inExpr && depth === 0) return i + 1;
        depth--;
      }
      if (/[\w$]/.test(c)) {
        let j = i;
        while (j < n && /[\w$]/.test(src[j]!)) j++;
        prevWord = src.slice(i, j);
        prev = 'w';
        i = j;
        continue;
      }
      prev = c;
      prevWord = '';
      i++;
    }
    return n;
  };

  code(0, false);
  return out.sort((a, b) => a.start - b.start);
}

/** The balanced `(...)` or `{...}` opening at `open`, outer delimiters excluded; null when unbalanced. */
export function balanced(src: string, open: number, lits = literals(src)): string | null {
  const o = src[open];
  const c = o === '(' ? ')' : o === '{' ? '}' : null;
  if (!c) return null;
  const skip = new Map(lits.map((l) => [l.start, l.end]));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const end = skip.get(i);
    if (end !== undefined) i = end - 1;
    else if (src[i] === o) depth++;
    else if (src[i] === c && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}
