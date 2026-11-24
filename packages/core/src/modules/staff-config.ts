import { HttpError } from '../platform/http.ts';

export interface StaffMember {
  name: string;
  email: string;
  whatsapp: string;
  /** Telegram numeric user id: receives staff alerts in DM and may use commands/buttons */
  telegram?: string;
  /** Telegram @username (without @), stored for display in Config → Equipe when linked via /start */
  telegramUsername?: string;
}

export interface StaffConfig {
  members: StaffMember[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const TELEGRAM_ID_RE = /^\d{5,20}$/;
const TELEGRAM_USER_RE = /^[A-Za-z0-9_]{3,64}$/;
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
    const telegram = s('telegram', 25);
    const rawUser = s('telegramUsername', 65).replace(/^@/, '');
    if (email && !EMAIL_RE.test(email)) throw bad(`members.${i}.email`, 'must be an email address');
    const whatsapp = rawWa ? normalizeWhatsapp(rawWa) : '';
    if (whatsapp === null) throw bad(`members.${i}.whatsapp`, 'must be a phone number');
    if (telegram && !TELEGRAM_ID_RE.test(telegram))
      throw bad(`members.${i}.telegram`, 'must be a Telegram user id (5–20 digits)');
    if (rawUser && !TELEGRAM_USER_RE.test(rawUser))
      throw bad(`members.${i}.telegramUsername`, 'must be a Telegram username');
    if (!email && !whatsapp && !telegram)
      throw bad(`members.${i}`, 'needs an email, a whatsapp or a telegram id');
    return {
      name,
      email,
      whatsapp,
      ...(telegram ? { telegram } : {}),
      ...(telegram && rawUser ? { telegramUsername: rawUser } : {}),
    };
  });
  // legacy `events` and `discord` keys are dropped on save
  return { members };
}

/** Unique Telegram DMs linked on the team roster (preserving order). */
export function linkedTelegramMembers(
  cfg: StaffConfig,
): { chatId: string; name: string; username: string | null }[] {
  const seen = new Set<string>();
  const out: { chatId: string; name: string; username: string | null }[] = [];
  for (const m of cfg.members) {
    const id = typeof m.telegram === 'string' ? m.telegram.trim() : '';
    if (!id || !TELEGRAM_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      chatId: id,
      name: m.name?.trim() || m.email || 'equipe',
      username: m.telegramUsername?.trim() || null,
    });
  }
  return out;
}
