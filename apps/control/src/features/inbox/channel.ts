import { Mail, MessageCircle, PenLine } from 'lucide-react';
import type { LeadListItem } from '@/lib/api.ts';

export const CHANNELS = [
  ['whatsapp', 'whatsapp'],
  ['email', 'email'],
  ['manual', 'manual'],
] as const;
export const CH_LABEL: Record<string, string> = Object.fromEntries(CHANNELS);
export const CH_ICON: Record<string, typeof Mail> = {
  whatsapp: MessageCircle,
  email: Mail,
  manual: PenLine,
};

// Channels a fresh conversation can start on — gated by lead data (manual never dispatches).
export const CH_PICK: { ch: string; has: (l: LeadListItem) => boolean }[] = [
  { ch: 'whatsapp', has: (l) => Boolean(l.whatsapp) },
  { ch: 'email', has: (l) => Boolean(l.email) },
  { ch: 'manual', has: () => true },
];
