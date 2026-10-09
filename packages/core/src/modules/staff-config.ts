import { HttpError } from '../platform/http.ts';

export interface StaffMember {
  name: string;
  email: string;
  whatsapp: string;
  /** Discord user id: the person may use the Venduá bot (ADR 0023) */
  discord?: string;
}

export interface StaffConfig {
  members: StaffMember[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISCORD_ID_RE = /^\d{17,20}$/;
const MAX_MEMBERS = 20;

/** '+55 (11) 99999-0000', '11999990000', '5511999990000' → '+5511999990000';
 *  10–11 bare digits are read as a BR number with DDD. null = not a phone. */
export function normalizeWhatsapp(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (/^\s*\+/.test(raw)) return d.length >= 8 && d.length <= 15 && d[0] !== '0' ? `+${d}` : null;
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if (d.length >= 12 && d.length <= 15 && d[0] !== '0') return `+${d}`;
  return null;
}

/** Validates and canonicalizes the `staff` setting (trimmed, lowercased email, +E.164 whatsapp). */
export function normalizeStaff(value: unknown): StaffConfig {
  const bad = (field: string, why: string) =>
    new HttpError(422, 'BAD_REQUEST', `settings.staff.${field} ${why}`, { field });
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw bad('*', 'must be an object');
  const v = value as Record<string, unknown>;
  const rawMembers = v.members ?? [];
  if (!Array.isArray(rawMembers) || rawMembers.length > MAX_MEMBERS) {
    throw bad('members', `must be an array of ≤${MAX_MEMBERS} people`);
  }
  const members = rawMembers.map((m, i): StaffMember => {
    if (!m || typeof m !== 'object' || Array.isArray(m))
      throw bad(`members.${i}`, 'must be an object');
    const r = m as Record<string, unknown>;
    const s = (k: string, max: number) => {
      const x = r[k] ?? '';
      if (typeof x !== 'string' || x.length > max)
        throw bad(`members.${i}.${k}`, `must be a string (≤${max} chars)`);
      return x.trim();
    };
    const name = s('name', 80);
    const email = s('email', 320).toLowerCase();
    const rawWa = s('whatsapp', 40);
    const discord = s('discord', 25);
    if (email && !EMAIL_RE.test(email)) throw bad(`members.${i}.email`, 'must be an email address');
    const whatsapp = rawWa ? normalizeWhatsapp(rawWa) : '';
    if (whatsapp === null) throw bad(`members.${i}.whatsapp`, 'must be a phone number');
    if (discord && !DISCORD_ID_RE.test(discord))
      throw bad(`members.${i}.discord`, 'must be a Discord user id (17–20 digits)');
    if (!email && !whatsapp && !discord)
      throw bad(`members.${i}`, 'needs an email, a whatsapp or a discord id');
    return { name, email, whatsapp, ...(discord ? { discord } : {}) };
  });
  // a stored `events` (the retired email/WhatsApp toggles) is dropped on the next save
  return { members };
}
