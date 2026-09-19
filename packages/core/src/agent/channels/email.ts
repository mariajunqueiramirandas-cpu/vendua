import type { IntegrationRow } from '../../modules/integrations.ts';

/**
 * agent/channels/email — outbound drivers. `resend` posts to the Resend API;
 * `log` is the dev driver: writes the would-be send to the console and
 * returns a synthetic provider id so the whole draft→send→reply loop runs
 * with zero credentials.
 */
export async function sendEmail(
  integration: IntegrationRow,
  msg: { to: string; subject: string; body: string },
): Promise<string | null> {
  const driver = integration.driver;
  const config = integration.config ?? {};
  const secretRef = integration.secret_ref;

  if (driver === 'resend') {
    const apiKey = (secretRef && process.env[secretRef]) ?? process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error(`resend driver: missing ${secretRef ?? 'RESEND_API_KEY'}`);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: config.from ?? 'Venduá <agente@updates.vendua.com.br>',
        to: [msg.to],
        subject: msg.subject,
        text: msg.body,
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  }

  if (driver === 'log') {
    console.log(`[email:log] → ${msg.to} | ${msg.subject}\n${msg.body}`);
    return `log:${crypto.randomUUID()}`;
  }

  throw new Error(`unknown email driver: ${driver}`);
}
