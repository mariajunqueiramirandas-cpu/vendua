import { plans } from '$lib/content';

// How Duá's conversations are counted, with the real rule (packages/core/src/modules/billing/
// ai-allowance.ts, claimAiConversationTx): a shopper's message opens a conversation unless one of
// theirs started less than 24 hours before it (`started_at > now - 24h`), however many messages
// it holds. The owner's test chat never counts (vendedor/allowance.ts: channel 'test'). Hours here
// run from 0 (Friday 0h) to 48 (Sunday 0h).

export const WINDOW_H = 24;
export const SPAN_H = 48;

export interface Lane {
  id: string;
  name: string;
  /** the owner's "Testar como cliente" chat */
  test?: boolean;
  msgs: number[];
}

export interface Conv {
  lane: string;
  start: number;
  msgs: number;
  /** its place among this widget's conversations, oldest first */
  k: number;
}

export function example(): Lane[] {
  return [
    { id: 'bia', name: 'Bia', msgs: [17 + 40 / 60, 17 + 50 / 60, 18, 34, 43] },
    { id: 'luiz', name: 'Luiz', msgs: [11, 11.25, 12, 35.5] },
    { id: 'mariana', name: 'Mariana', msgs: [33, 33.5, 44] },
    { id: 'nena', name: 'Nena', test: true, msgs: [8, 8.5, 15] },
  ];
}

export function conversations(lanes: Lane[]): Conv[] {
  const out: Omit<Conv, 'k'>[] = [];
  for (const l of lanes) {
    if (l.test) continue;
    let open: Omit<Conv, 'k'> | null = null;
    for (const at of [...l.msgs].sort((a, b) => a - b)) {
      if (open && at - open.start < WINDOW_H) open.msgs++;
      else out.push((open = { lane: l.id, start: at, msgs: 1 }));
    }
  }
  return out.sort((a, b) => a.start - b.start).map((c, i) => ({ ...c, k: i + 1 }));
}

/** "sexta, 17h40" */
export function when(h: number): string {
  const day = h < 24 ? 'sexta' : 'sábado';
  const hh = Math.floor(h % 24);
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${day}, ${hh}h${mm ? String(mm).padStart(2, '0') : ''}`;
}

const n = (s: string) => Number(s.replace(/\D/g, ''));

/** The plan's allowance (Bandeira's month and its trial, from the site's plan facts) and an example
 *  of what was already spent before these two days. */
export const PLANS = {
  bandeira: { label: 'Venduá Bandeira', limit: n(plans.bandeira.conversations), before: 198 },
  teste: { label: 'No teste', limit: n(plans.bandeira.trialConversations), before: 46 },
};
export type PlanId = keyof typeof PLANS;
