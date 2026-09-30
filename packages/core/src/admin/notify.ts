import { sendEmail } from '../agent/channels/email.ts';
import { sendWhatsApp } from '../agent/channels/whatsapp.ts';
import { getIntegration } from '../modules/integrations.ts';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import type { MerchantNotify } from './context.ts';

const notifyLog = log.child({ mod: 'merchant-notify' });

/**
 * The platform's own WhatsApp number and email integration, as the admin uses them for store
 * people (sign-in links, invites, alerts, billing). Without an integration, dev logs the message
 * and production throws — callers record the failure, they never pretend it was sent.
 */
export function platformNotify(sql: Sql): MerchantNotify {
  const dev = process.env.NODE_ENV !== 'production';
  return {
    async whatsapp(phone, text) {
      const wa = await getIntegration(sql, 'whatsapp');
      if (!wa) {
        if (dev) return void notifyLog.info({ to: `…${phone.slice(-4)}`, text }, 'dev whatsapp');
        throw new Error('no whatsapp integration');
      }
      await sendWhatsApp(sql, wa, `55${phone}`, text);
    },
    async email(to, subject, text, idemKey) {
      const mail = await getIntegration(sql, 'email');
      if (!mail) {
        if (dev) return void notifyLog.info({ to, subject, text }, 'dev email');
        throw new Error('no email integration');
      }
      await sendEmail(mail, { to, subject, body: text, idemKey });
    },
  };
}
