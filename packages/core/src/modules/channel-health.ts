import type { Sql } from '../platform/db.ts';
import { controlTx } from './control.ts';

// 30d outbound rollup from sent/failed messages, 'blocked' activities, and email bounce markers; 'manual' excluded
export const HEALTH_WINDOW_DAYS = 30;
// volume floor keeps one bad send on an idle channel from paging
const MIN_ATTEMPTS = 5;
const FAILURE_RATE_ALERT = 0.2;

export interface ChannelHealth {
  channel: 'whatsapp' | 'email';
  sent: number;
  failed: number;
  blocked: number;
  blockedByReason: Record<string, number>;
  /** leads whose email bounce marker was set inside the window (0 on whatsapp). */
  bounced: number;
  /** failed / (sent + failed); null when nothing resolved yet. */
  failureRate: number | null;
  alert: boolean;
}

// must run inside the caller's claim tx — a replayed decision must not double-count
export async function recordBlockedSendTx(
  tx: Sql,
  leadId: string,
  channel: string,
  reason: string,
): Promise<void> {
  await tx`
    insert into lead_activities (lead_id, kind, body, meta, created_by)
    values (${leadId}, 'blocked', ${`envio ${channel} bloqueado — ${reason}`},
            ${tx.json({ channel, reason } as never)}, 'agent')
  `;
}

export async function channelHealth(sql: Sql): Promise<ChannelHealth[]> {
  return controlTx(sql, async (tx) => {
    const attempts = await tx<{ channel: string; sent: number; failed: number }[]>`
      select t.channel,
             count(*) filter (where m.status in ('sent', 'delivered'))::int as sent,
             count(*) filter (where m.status = 'failed')::int as failed
      from lead_messages m
      join lead_threads t on t.id = m.thread_id
      where m.direction = 'out' and t.channel in ('whatsapp', 'email')
        and m.created_at > now() - make_interval(days => ${HEALTH_WINDOW_DAYS})
      group by 1
    `;
    const blocks = await tx<{ channel: string; reason: string; n: number }[]>`
      select meta->>'channel' as channel, meta->>'reason' as reason, count(*)::int as n
      from lead_activities
      where kind = 'blocked' and at > now() - make_interval(days => ${HEALTH_WINDOW_DAYS})
        and meta->>'channel' in ('whatsapp', 'email')
      group by 1, 2
    `;
    const bounced = (
      await tx<{ n: number }[]>`
        select count(*)::int as n from leads
        where email_bounced_at > now() - make_interval(days => ${HEALTH_WINDOW_DAYS})
      `
    )[0]!.n;

    const byChannel = new Map(attempts.map((a) => [a.channel, a]));
    const blockedBy: Record<string, Record<string, number>> = {};
    for (const b of blocks) {
      (blockedBy[b.channel] ??= {})[b.reason] = b.n;
    }
    return (['whatsapp', 'email'] as const).map((channel) => {
      const a = byChannel.get(channel);
      const sent = a?.sent ?? 0;
      const failed = a?.failed ?? 0;
      const reasons = blockedBy[channel] ?? {};
      const blocked = Object.values(reasons).reduce((s, n) => s + n, 0);
      const attemptsN = sent + failed;
      const failureRate = attemptsN ? failed / attemptsN : null;
      return {
        channel,
        sent,
        failed,
        blocked,
        blockedByReason: reasons,
        bounced: channel === 'email' ? bounced : 0,
        failureRate,
        alert: attemptsN >= MIN_ATTEMPTS && (failureRate ?? 0) >= FAILURE_RATE_ALERT,
      };
    });
  });
}
