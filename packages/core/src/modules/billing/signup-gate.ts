import { whatsappReadyTx } from '../../agent/guardrails.ts';
import type { Sql } from '../../platform/db.ts';
import { controlTx } from '../control.ts';
import { getIntegrationTx, getSettingTx, integrationJson } from '../integrations.ts';
import type { PaymentProvider } from '../payments/provider.ts';
import { signupAccessCode } from './signup.ts';

// Self-serve signup opens only when the team turned it on in the CRM and what it relies on is
// there (the owner's decision, ADR 0032): the platform WhatsApp that sends the phone code, the
// email that welcomes the owner and carries the invoices, and a way to pay (Mercado Pago, or the
// access code). A 'log' driver only counts outside production.

export const SIGNUP_SETTING = 'signup';

export interface SignupReadiness {
  /** the CRM switch (control_settings 'signup') */
  on: boolean;
  whatsapp: boolean;
  email: boolean;
  billing: boolean;
  open: boolean;
}

const prod = () => process.env.NODE_ENV === 'production';

export async function signupReadiness(
  sql: Sql,
  provider: Pick<PaymentProvider, 'platformConfigured'>,
): Promise<SignupReadiness> {
  return controlTx(sql, async (tx) => {
    const on = (await getSettingTx<{ enabled?: unknown }>(tx, SIGNUP_SETTING, {})).enabled === true;
    const wa = await getIntegrationTx(tx, 'whatsapp');
    const whatsapp = !!wa && (wa.driver !== 'log' || !prod()) && (await whatsappReadyTx(tx));
    const mail = await getIntegrationTx(tx, 'email');
    const email =
      !!mail && (mail.driver === 'log' ? !prod() : integrationJson(mail).secretPresent !== false);
    const billing = provider.platformConfigured || !!signupAccessCode();
    return { on, whatsapp, email, billing, open: on && whatsapp && email && billing };
  });
}
