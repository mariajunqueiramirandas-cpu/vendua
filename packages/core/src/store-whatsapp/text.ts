import { createHash } from 'node:crypto';

// Pure helpers shared by Core (enqueue) and the gateway (send/receive). No DB, no socket.

/** National BR number (what orders store, `normalizePhone`) → WhatsApp user jid; null if not a phone. */
export function jidForPhone(national: string): string | null {
  const d = national.replace(/\D/g, '');
  const full = d.length >= 12 && d.startsWith('55') ? d : `55${d}`;
  return /^55\d{10,11}$/.test(full) ? `${full}@s.whatsapp.net` : null;
}

/** '5511…:3@s.whatsapp.net' → '11…' (national digits); null for non-phone jids (lid, groups). */
export function phoneForJid(jid: string | null | undefined): string | null {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return null;
  const d = jid.split('@')[0]!.split(':')[0]!.replace(/\D/g, '');
  if (!d.startsWith('55')) return null;
  const national = d.slice(2);
  return /^\d{10,11}$/.test(national) ? national : null;
}

/** A user jid without its device or agent part ('5511…:3@s.whatsapp.net' → '5511…@s.whatsapp.net');
 *  null for anything that isn't a person (groups, broadcasts, newsletters, status). */
export function userJid(jid: string | null | undefined): string | null {
  const m = /^(\d{1,40})(?:_\d+)?(?::\d+)?@(s\.whatsapp\.net|lid)$/.exec(jid ?? '');
  return m ? `${m[1]}@${m[2]}` : null;
}

/** A conversation's phone: national digits for Brazil, '+' and the full number for anyone else,
 *  null for a LID. Unlike `phoneForJid` (opt-outs, order notices: Brazil only) it never drops a
 *  foreign shopper. */
export function threadPhoneForJid(jid: string | null | undefined): string | null {
  const national = phoneForJid(jid);
  if (national) return national;
  const u = userJid(jid);
  if (!u?.endsWith('@s.whatsapp.net')) return null;
  const d = u.split('@')[0]!;
  return /^\d{8,15}$/.test(d) ? `+${d}` : null;
}

/** Brazilian mobiles may be registered with or without the 9th digit; WhatsApp only knows one.
 *  Both forms of a number, the one we were given first — `onWhatsApp` picks the live one. */
export function phoneVariants(national: string): string[] {
  const d = national.replace(/\D/g, '');
  if (d.length === 11 && d[2] === '9') return [d, d.slice(0, 2) + d.slice(3)];
  if (d.length === 10 && /[6-9]/.test(d[2]!)) return [d, `${d.slice(0, 2)}9${d.slice(2)}`];
  return [d];
}

/** The forms a thread's phone may be stored under elsewhere (orders, coupons): both 9th-digit
 *  spellings of a Brazilian number; a foreign `+…` number only as itself; none for no number. */
export function phoneKeys(phone: string | null | undefined): string[] {
  if (!phone) return [];
  return phone.startsWith('+') ? [phone] : phoneVariants(phone);
}

/** Same row → same WhatsApp message id, so a resend after a crash mid-send is deduplicated by
 *  WhatsApp instead of reaching the shopper twice. Same shape as baileys' own ids. */
export function messageIdFor(rowId: string): string {
  return `3EB0${createHash('sha256').update(`vendua.wa|${rowId}`).digest('hex').toUpperCase().slice(0, 18)}`;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const OPT_OUT = new Set(['sair', 'parar', 'stop', 'descadastrar', 'cancelarmensagens']);
const OPT_IN = new Set(['voltar', 'receber']);

/** A whole message that is only a stop/start keyword. "pode parar de mandar?" is a conversation
 *  for the store, not a command — only the bare word counts. */
export function optKeyword(text: string): 'out' | 'in' | null {
  if (text.length > 40) return null;
  const k = fold(text);
  if (OPT_OUT.has(k)) return 'out';
  if (OPT_IN.has(k)) return 'in';
  return null;
}

/** Retry delay after the nth failed attempt (1-based): 30 s, 2 min, 8 min, 30 min, capped. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30 * 60_000, 30_000 * 4 ** Math.max(0, attempt - 1));
}

/** Reconnect delay after the nth consecutive failed connection: 2 s doubling to 5 min, ±20%. */
export function reconnectDelayMs(failures: number, rand = Math.random): number {
  const base = Math.min(5 * 60_000, 2_000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.8 + rand() * 0.4));
}
