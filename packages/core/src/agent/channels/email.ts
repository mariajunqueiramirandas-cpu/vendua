import type { IntegrationRow } from '../../modules/integrations.ts';
import { log } from '../../platform/log.ts';
import { renderReplyEmail } from './email-template.ts';

const mailLog = log.child({ mod: 'email' });

/**
 * agent/channels/email — outbound drivers. `resend` posts to the Resend API;
 * `log` is the dev driver: writes the would-be send to the log and
 * returns a synthetic provider id so the whole draft→send→reply loop runs
 * with zero credentials.
 */
export async function sendEmail(
  integration: IntegrationRow,
  msg: { to: string; subject: string; body: string; idemKey?: string },
): Promise<string | null> {
  const driver = integration.driver;
  const config = integration.config ?? {};
  const secretRef = integration.secret_ref;

  if (driver === 'resend') {
    const apiKey = (secretRef && process.env[secretRef]) ?? process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error(`resend driver: missing ${secretRef ?? 'RESEND_API_KEY'}`);
    const from =
      typeof config.from === 'string' && config.from
        ? config.from
        : 'Venduá <agente@auto.vendua.com.br>';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        // Resend dedupes on this key — a reclaimed caller retrying the same
        // logical send (e.g. the daily digest) can't double-deliver.
        ...(msg.idemKey ? { 'idempotency-key': msg.idemKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.body,
        html: renderReplyEmail({ body: msg.body, subject: msg.subject, from }),
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  }

  if (driver === 'log') {
    mailLog.info({ to: msg.to, subject: msg.subject, body: msg.body }, 'log-driver send');
    return `log:${crypto.randomUUID()}`;
  }

  throw new Error(`unknown email driver: ${driver}`);
}
