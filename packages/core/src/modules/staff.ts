import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { sendEmail } from '../agent/channels/email.ts';
import { sendWhatsApp } from '../agent/channels/whatsapp.ts';
import { controlTx } from './control.ts';
import { getIntegrationTx, getSettingTx, type IntegrationRow } from './integrations.ts';
import { DEFAULT_STAFF, type StaffConfig, type StaffEvent } from './staff-config.ts';

const staffLog = log.child({ mod: 'staff-notify' });

export interface StaffNotice {
  subject: string;
  body: string;
  /** provider dedupe key prefix — one per logical event */
  idemKey?: string;
}

export interface StaffDelivery {
  name: string;
  channel: 'email' | 'whatsapp';
  to: string;
  ok: boolean;
  error?: string;
}

export async function staffConfigTx(tx: Sql): Promise<StaffConfig> {
  const stored = await getSettingTx<Partial<StaffConfig>>(tx, 'staff', {});
  return {
    members: stored.members ?? DEFAULT_STAFF.members,
    events: { ...DEFAULT_STAFF.events, ...stored.events },
  };
}

export async function staffWhatsappsTx(tx: Sql): Promise<string[]> {
  return (await staffConfigTx(tx)).members.map((m) => m.whatsapp).filter(Boolean);
}

/** Fans a notice out to every staff email + whatsapp through the active providers.
 *  `event` null = always send (test); otherwise gated by `staff.events`. Never throws. */
export async function notifyStaff(
  sql: Sql,
  event: StaffEvent | null,
  notice: StaffNotice,
): Promise<StaffDelivery[]> {
  let snap: { cfg: StaffConfig; email: IntegrationRow | null; wa: IntegrationRow | null };
  try {
    snap = await controlTx(sql, async (tx) => ({
      cfg: await staffConfigTx(tx),
      email: await getIntegrationTx(tx, 'email'),
      wa: await getIntegrationTx(tx, 'whatsapp'),
    }));
  } catch (e) {
    staffLog.warn({ err: e instanceof Error ? e.message : String(e) }, 'staff config read failed');
    return [];
  }
  const { cfg, email, wa } = snap;
  if (event && !cfg.events[event]) return [];
  const text = `${notice.subject}\n\n${notice.body}`;
  const jobs = cfg.members.flatMap((m) => {
    const out: Promise<StaffDelivery>[] = [];
    const attempt = async (
      channel: StaffDelivery['channel'],
      to: string,
      send: () => Promise<unknown>,
    ): Promise<StaffDelivery> => {
      try {
        await send();
        return { name: m.name, channel, to, ok: true };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        staffLog.warn({ channel, event, error }, 'staff notification failed');
        return { name: m.name, channel, to, ok: false, error };
      }
    };
    if (m.email) {
      out.push(
        email
          ? attempt('email', m.email, () =>
              sendEmail(email, {
                to: m.email,
                subject: notice.subject,
                body: notice.body,
                ...(notice.idemKey ? { idemKey: `${notice.idemKey}:${m.email}` } : {}),
              }),
            )
          : Promise.resolve({
              name: m.name,
              channel: 'email',
              to: m.email,
              ok: false,
              error: 'nenhum provedor de email ativo',
            }),
      );
    }
    if (m.whatsapp) {
      out.push(
        wa
          ? attempt('whatsapp', m.whatsapp, () => sendWhatsApp(sql, wa, m.whatsapp, text))
          : Promise.resolve({
              name: m.name,
              channel: 'whatsapp',
              to: m.whatsapp,
              ok: false,
              error: 'whatsapp não conectado',
            }),
      );
    }
    return out;
  });
  return Promise.all(jobs);
}
