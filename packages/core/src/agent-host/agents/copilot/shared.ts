import { ToolError, type ToolContext } from '@vendua/agent-runtime';
import type { Merchant, Role } from '../../../admin/context.ts';
import { runRoute, type Replay } from '../../../admin/handlers.ts';
import type { Sql } from '../../../platform/db.ts';
import { planHas } from '../../../modules/billing/plans.ts';
import { HttpError } from '../../../platform/http.ts';
import type { Tenant } from '../../../platform/tenancy.ts';
import { addDays, localDateOf, type LocalDate } from '../../../platform/tz.ts';
import { brl } from '../../../vendedor/cards.ts';

export const COPILOT_AGENT_ID = 'copilot';
/** One conversation per merchant user: the subject id is `merchant_users.id`. */
export const COPILOT_SUBJECT = 'copilot';

export type Ctx = ToolContext<Sql>;

export interface Who {
  tenant: Tenant;
  merchant: Merchant;
  tz: string;
}

/**
 * The store and the person this conversation is with, read again on every call: someone removed
 * from the team, or whose role changed, gets what their access allows now.
 */
export async function who(ctx: Ctx): Promise<Who> {
  const [r] = await ctx.tx<
    {
      id: string;
      slug: string;
      name: string;
      status: string;
      user_name: string;
      phone: string;
      role: Role;
      tz: string | null;
    }[]
  >`
    select t.id, t.slug, t.name, t.status, u.name as user_name, u.phone, u.role,
           s.hours ->> 'timezone' as tz
    from tenants t
    join merchant_users u on u.tenant_id = t.id and u.id = ${ctx.subject.id} and u.status = 'active'
    left join store_settings s on s.tenant_id = t.id
    where t.id = ${ctx.tenantId}`;
  if (!r) throw new ToolError('Essa pessoa não faz mais parte da equipe da loja.');
  // a turn queued before a downgrade or a suspension reads and proposes nothing
  if (r.status !== 'active' || !(await planHas(ctx.tx, ctx.tenantId, 'copilot')))
    throw new ToolError('BLOQUEADO: o Copiloto não está disponível para esta loja agora.');
  return {
    tenant: { id: r.id, slug: r.slug, name: r.name, status: r.status },
    merchant: {
      userId: ctx.subject.id,
      sessionId: '',
      name: r.user_name,
      phone: r.phone,
      role: r.role,
    },
    tz: r.tz || 'America/Sao_Paulo',
  };
}

/** Why Core refused, in words the model can relay. */
export function refused(e: unknown): never {
  if (e instanceof HttpError) {
    if (e.code === 'FORBIDDEN')
      throw new ToolError(
        `BLOQUEADO: o papel desta pessoa na equipe não permite isso. Diga que só ${(e.details as { need?: string } | undefined)?.need === 'owner' ? 'o dono' : 'o dono ou um gerente'} pode.`,
      );
    if (e.code === 'PLAN_REQUIRED')
      throw new ToolError('BLOQUEADO: o plano da loja não inclui isso.');
    if (e.status < 500) throw new ToolError(`A loja recusou (${e.code}): ${e.message}`);
  }
  throw e;
}

/** A named admin route's answer, as the screen would get it. */
export async function adminRead<T>(ctx: Ctx, w: Who, name: string, r: Replay = {}): Promise<T> {
  try {
    return (await runRoute(ctx.tx, name, w.tenant, w.merchant, r)) as T;
  } catch (e) {
    return refused(e);
  }
}

/** Enters a money figure and returns its reference. */
export function money(ctx: Ctx, id: string, cents: number): string {
  ctx.figure(id, { value: cents, text: brl(cents), kind: 'money' });
  return `{{${id}}}`;
}

/** A percentage Core computed (a change, a share), as a reference. */
export function pct(ctx: Ctx, id: string, value: number, signed = false): string {
  const v = Math.round(value);
  ctx.figure(id, { value: v, text: `${signed && v > 0 ? '+' : ''}${v}%`, kind: 'text' });
  return `{{${id}}}`;
}

/** Basis points Core stores (a fee, a surcharge), to the hundredth as the screen shows them. */
export function bps(ctx: Ctx, id: string, value: number, signed = false): string {
  const n = (value / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  ctx.figure(id, { value, text: `${signed && value > 0 ? '+' : ''}${n}%`, kind: 'text' });
  return `{{${id}}}`;
}

/** A clock time or date in the store's zone, as a reference. */
export function at(ctx: Ctx, id: string, d: Date, tz: string, withDay = false): string {
  const hm = d.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const text = withDay
    ? `${d.toLocaleDateString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' })} às ${hm}`
    : hm;
  ctx.figure(id, { value: d.toISOString(), text, kind: 'time' });
  return `{{${id}}}`;
}

/** A duration in minutes, as a reference. */
export function mins(ctx: Ctx, id: string, n: number): string {
  ctx.figure(id, { value: n, text: `${n} min`, kind: 'duration' });
  return `{{${id}}}`;
}

/** % change of `now` over `before`; null when there's nothing to compare. */
export function change(now: number, before: number): number | null {
  return before > 0 ? ((now - before) / before) * 100 : null;
}

const iso = (d: LocalDate) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

export const PERIODS = ['hoje', 'ontem', '7d', '30d', 'mes', 'mes_passado'] as const;
export type Period = (typeof PERIODS)[number];

/** A named period as the Relatórios screen's from/to, in the store's calendar. */
export function periodRange(p: Period, tz: string, now: Date): { from: string; to: string } {
  const today = localDateOf(now, tz);
  switch (p) {
    case 'hoje':
      return { from: iso(today), to: iso(today) };
    case 'ontem': {
      const y = addDays(today, -1);
      return { from: iso(y), to: iso(y) };
    }
    case '7d':
      return { from: iso(addDays(today, -6)), to: iso(today) };
    case '30d':
      return { from: iso(addDays(today, -29)), to: iso(today) };
    case 'mes':
      return { from: iso({ ...today, day: 1 }), to: iso(today) };
    case 'mes_passado': {
      const last = addDays({ ...today, day: 1 }, -1);
      return { from: iso({ ...last, day: 1 }), to: iso(last) };
    }
  }
}

/** Today in the store's calendar, YYYY-MM-DD. */
export function todayIn(tz: string, now: Date): string {
  return iso(localDateOf(now, tz));
}
