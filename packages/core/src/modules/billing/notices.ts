import { withTenant } from '../../platform/db.ts';
import { billingLog, type InvoiceRow } from './invoices.ts';
import { formatBRL } from './plans.ts';
import type { BillingCtx } from './subscriptions.ts';

// What the owner hears about the plan, by WhatsApp and (unless prefs.emailInvoices is false)
// email. Every caller sends on a state transition it just made, so each notice goes once.

export const dayMonth = (d: Date) =>
  d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  });

export interface OwnerMessage {
  text: string;
  subject: string;
}

const where = (origin: string | null) =>
  origin ? ` Veja em Conta: ${origin}/admin/conta` : ' Veja em Conta, no painel.';

export function pastDueMessage(planName: string, periodEnd: Date | null, origin: string | null) {
  return {
    text: `Venduá: o pagamento do plano ${planName}${periodEnd ? ` do período que terminou em ${dayMonth(periodEnd)}` : ''} ainda não foi confirmado.${where(origin)}`,
    subject: 'Venduá: pagamento do plano em atraso',
  };
}

export function chargeFailedMessage(planName: string, cents: number, origin: string | null) {
  return {
    text: `Venduá: a cobrança de ${formatBRL(cents)} no cartão para o plano ${planName} não foi aprovada. Confira o cartão ou troque a forma de pagamento.${where(origin)}`,
    subject: 'Venduá: cobrança do plano não aprovada',
  };
}

export function cancelScheduledMessage(
  planName: string,
  periodEnd: Date | null,
  origin: string | null,
) {
  const until = periodEnd
    ? ` O plano vale até ${dayMonth(periodEnd)}; depois disso a loja fica fechada.`
    : '';
  const undo = origin
    ? ` Para desfazer, acesse Conta: ${origin}/admin/conta`
    : ' Para desfazer, acesse Conta, no painel.';
  return {
    text: `Venduá: o cancelamento do plano ${planName} foi agendado.${until}${undo}`,
    subject: 'Venduá: cancelamento do plano agendado',
  };
}

export function cancelledMessage(planName: string, closed: boolean, origin: string | null) {
  return {
    text: closed
      ? `Venduá: o plano ${planName} foi encerrado e a loja está fechada. Para reabrir, assine um plano.${where(origin)}`
      : `Venduá: a assinatura do plano ${planName} foi cancelada.${where(origin)}`,
    subject: 'Venduá: plano encerrado',
  };
}

export function reminderMessage(
  stage: 'due_soon' | 'due' | 'overdue',
  inv: Pick<InvoiceRow, 'number' | 'amount_cents' | 'due_at'>,
  planName: string,
  origin: string | null,
): OwnerMessage {
  const what = `a fatura ${inv.number} do plano ${planName} (${formatBRL(inv.amount_cents)})`;
  const line =
    stage === 'due_soon'
      ? `Venduá: ${what} vence em ${dayMonth(inv.due_at)}.`
      : stage === 'due'
        ? `Venduá: ${what} vence hoje.`
        : `Venduá: ${what} venceu em ${dayMonth(inv.due_at)} e ainda está em aberto.`;
  const pix = origin
    ? ` O Pix está em Conta: ${origin}/admin/conta`
    : ' O Pix está em Conta, no painel.';
  const subject =
    stage === 'due_soon'
      ? `Fatura ${inv.number} vence em ${dayMonth(inv.due_at)}`
      : stage === 'due'
        ? `Fatura ${inv.number} vence hoje`
        : `Fatura ${inv.number} em aberto`;
  return { text: line + pix, subject: `Venduá: ${subject}` };
}

/** Deliver to every active owner; failures are logged, never retried into a second message. */
export async function messageOwners(
  ctx: Pick<BillingCtx, 'sql' | 'notify'>,
  tenantId: string,
  msg: OwnerMessage,
  key: string,
) {
  const owners = await withTenant(
    ctx.sql,
    tenantId,
    (tx) => tx<{ phone: string; email: string | null; prefs: Record<string, unknown> | null }[]>`
      select phone, email, prefs from merchant_users
      where tenant_id = ${tenantId} and role = 'owner' and status = 'active'
    `,
  );
  for (const u of owners) {
    await ctx.notify
      .whatsapp(u.phone, msg.text)
      .catch((err) => billingLog.warn({ err, key }, 'billing whatsapp to owner failed'));
    if (u.email && u.prefs?.emailInvoices !== false)
      await ctx.notify
        .email(u.email, msg.subject, msg.text, `${key}:${u.email}`)
        .catch((err) => billingLog.warn({ err, key }, 'billing email to owner failed'));
  }
}

/** After the tx: tell the owners. */
export function queueOwners(ctx: BillingCtx, tenantId: string, msg: OwnerMessage, key: string) {
  ctx.later(() => messageOwners(ctx, tenantId, msg, key));
}
