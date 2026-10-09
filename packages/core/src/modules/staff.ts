import type { Sql } from '../platform/db.ts';
import { getSettingTx, type Guardrails } from './integrations.ts';
import type { StaffConfig } from './staff-config.ts';

// The team roster. Staff hear about things only through staff events on Discord (ADR 0023):
// `recordStaffEventTx` in the transaction that commits the change. Nothing here sends.

export async function staffConfigTx(tx: Sql): Promise<StaffConfig> {
  const stored = await getSettingTx<Partial<StaffConfig>>(tx, 'staff', {});
  return { members: stored.members ?? [] };
}

export async function staffWhatsappsTx(tx: Sql): Promise<string[]> {
  return (await staffConfigTx(tx)).members.map((m) => m.whatsapp).filter(Boolean);
}

/** Numbers the agent never treats as leads: the team's whatsapps, plus the retired
 *  `guardrails.ignoredPhones` list (no UI anymore; still honored so old rows keep working). */
export async function blockedPhonesTx(tx: Sql): Promise<string[]> {
  const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
  const legacy = Array.isArray(g.ignoredPhones) ? g.ignoredPhones : [];
  return [...legacy, ...(await staffWhatsappsTx(tx))];
}
