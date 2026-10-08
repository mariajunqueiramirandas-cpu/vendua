import type { Context } from 'hono';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { audit, auditChanges } from './audit.ts';
import { forgetGate, startEmailChange, validAdminEmail, validAdminPhone } from './auth.ts';
import { ROLES, oneOf, text, type AdminCtx, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { storeTz } from './routes-orders.ts';

const ROLE_LABEL = { owner: 'dono', manager: 'gerente', attendant: 'atendente' } as const;
/** resends per member per rolling hour */
const INVITES_PER_HOUR = 3;

const teamLog = log.child({ mod: 'admin-team' });

/** Equipe's "quem mudou o quê" filter: the audit entities each kind of thing covers */
export const ACTIVITY_KINDS = {
  pedidos: ['order'],
  cardapio: ['product', 'category', 'import', 'modifier', 'catalog'],
  loja: [
    'store',
    'zone',
    'kitchen',
    'printer',
    'printers',
    'print_device',
    'whatsapp',
    'page',
    'tokens',
  ],
  clientes: ['customer'],
  marketing: ['coupon', 'loyalty'],
  pagamentos: ['payments'],
  equipe: ['member'],
  conta: ['account', 'invoice', 'custom_domain', 'help'],
  vendedor: ['thread', 'store_agent', 'store_knowledge', 'vendedor_runs'],
} as const satisfies Record<string, readonly string[]>;
type ActivityKind = keyof typeof ACTIVITY_KINDS;

type Delivery = 'sent' | 'failed' | 'skipped';
export type InviteResult = { whatsapp: Delivery; email: Delivery };

async function team(tx: Sql, tenantId: string) {
  return tx`
    select id, name, phone, email, pending_email as "pendingEmail", role, status, created_at as "createdAt", last_seen_at as "lastSeenAt",
           invite_sent_at as "inviteSentAt", invite_channels as "inviteChannels", invite_error as "inviteError"
    from merchant_users where tenant_id = ${tenantId}
    order by status = 'revoked', case role when 'owner' then 0 when 'manager' then 1 else 2 end, name
  `;
}

async function duaManagers(tx: Sql, tenantId: string) {
  const [row] = await tx<{ on: boolean }[]>`
    select dua_whatsapp_managers as on from store_settings where tenant_id = ${tenantId}
  `;
  return row?.on ?? true;
}

/** Serializes owner removals/demotions per store: two owners removing each other in parallel
 *  would each count the other as the one left. Taken before reading the member row. */
async function lockOwners(tx: Sql, tenantId: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`owners:${tenantId}`}, 0))`;
}

async function owners(tx: Sql, tenantId: string, except: string) {
  return (
    await tx<{ n: number }[]>`
      select count(*)::int as n from merchant_users
      where tenant_id = ${tenantId} and role = 'owner' and status = 'active' and id <> ${except}
    `
  )[0]!.n;
}

type InviteJob = {
  memberId: string;
  name: string;
  phone: string;
  email: string | null;
  /** the address waits in pending_email: the invite carries the link that proves it */
  confirm?: boolean;
  inviter: string;
  store: string;
};

/** What the member row says was delivered last — the answer a replay gets. */
function recorded(row: {
  invite_channels: string[];
  email: string | null;
  pending_email: string | null;
  invite_sent_at: unknown;
  invite_error: string | null;
}): InviteResult {
  const tried = row.invite_sent_at !== null || row.invite_error !== null;
  const ch = row.invite_channels ?? [];
  return {
    whatsapp: ch.includes('whatsapp') ? 'sent' : tried ? 'failed' : 'skipped',
    email: !(row.email ?? row.pending_email)
      ? 'skipped'
      : ch.includes('email')
        ? 'sent'
        : tried
          ? 'failed'
          : 'skipped',
  };
}

export function mountTeam(d: AdminDeps) {
  const { admin, sql } = d;
  const { read, write } = handlers(d);

  // Sends after the claim tx commits (so a rolled-back add never messages anyone) and records
  // the outcome on the member row. The claim's stored response carries only the job; a replay
  // of the same Idempotency-Key reads the recorded outcome instead of sending again.
  async function deliver(c: Context, job: InviteJob): Promise<InviteResult> {
    const url = `${d.publicOrigin(c)}/admin/`;
    const msg = `${job.inviter} adicionou você à equipe da ${job.store} na Venduá. Entre com este número em ${url}`;
    const out: InviteResult = { whatsapp: 'failed', email: job.email ? 'failed' : 'skipped' };
    const errors: string[] = [];
    try {
      await d.notify.whatsapp(job.phone, msg);
      out.whatsapp = 'sent';
    } catch (err) {
      errors.push(`whatsapp: ${(err as Error).message ?? 'failed'}`);
    }
    if (job.email)
      try {
        const subject = `Você entrou na equipe da ${job.store}`;
        const intro = `${job.inviter} adicionou você à equipe da ${job.store} na Venduá.`;
        if (job.confirm) {
          let sending: Promise<void> | undefined;
          const link = await startEmailChange(
            sql,
            { tenantId: (c as AdminCtx).get('tenant').id, userId: job.memberId, email: job.email },
            (token) => `${url}entrar?link=${token}`,
            (to, link, linkId) =>
              (sending = d.notify.email(
                to,
                subject,
                `${intro}\n\nToque no link para confirmar este email e entrar no painel:\n\n${link}\n\nEle vale por 15 minutos e funciona uma vez. Depois disso, você também pode entrar com este email. Ou entre em ${url} com o número ${job.phone} — o código chega pelo WhatsApp. Se não foi com você, ignore este email.`,
                `admin-invite:${job.memberId}:${linkId}`,
              )),
          );
          if (!link.sent) throw new Error('too many links to this address');
          await sending;
        } else
          await d.notify.email(
            job.email,
            subject,
            `${intro}\n\nEntre em ${url} com o número ${job.phone} — o código chega pelo WhatsApp. Se não chegar, peça um link por este email.`,
            `admin-invite:${job.memberId}:${Date.now()}`,
          );
        out.email = 'sent';
      } catch (err) {
        errors.push(`email: ${(err as Error).message ?? 'failed'}`);
      }
    if (errors.length) teamLog.warn({ errors }, 'invite delivery failed');
    const channels = (['whatsapp', 'email'] as const).filter((k) => out[k] === 'sent');
    await withTenant(sql, (c as AdminCtx).get('tenant').id, async (tx) => {
      await tx`
        update merchant_users set
          invite_sent_at = ${channels.length ? tx`now()` : tx`invite_sent_at`},
          invite_channels = ${channels.length ? channels : tx`invite_channels`},
          invite_error = ${errors.length ? errors.join('; ').slice(0, 200) : null}
        where id = ${job.memberId}
      `;
      await emitAdminTx(tx, (c as AdminCtx).get('tenant').id, 'team');
    });
    return out;
  }

  // the claim answers { job }; the client sees { members, invite, signInUrl }
  const inviteRoute =
    (claim: ReturnType<typeof write>) =>
    async (c: AdminCtx): Promise<Response> => {
      const res = await claim(c);
      if (res.status >= 300) return res;
      const { job } = (await res.json()) as { job: InviteJob };
      const replay = res.headers.get('x-idempotent-replay') === 'true';
      const t = c.get('tenant');
      const invite = replay
        ? await withTenant(sql, t.id, async (tx) => {
            const row = (
              await tx<Parameters<typeof recorded>[0][]>`
                select invite_channels, email, pending_email, invite_sent_at, invite_error from merchant_users
                where tenant_id = ${t.id} and id = ${job.memberId}
              `
            )[0];
            return row
              ? recorded(row)
              : { whatsapp: 'skipped' as const, email: 'skipped' as const };
          })
        : await deliver(c, job);
      const members = await withTenant(sql, t.id, (tx) => team(tx, t.id));
      if (replay) c.header('x-idempotent-replay', 'true');
      return c.json({ members, invite, signInUrl: '/admin/' }, res.status as 200);
    };

  admin.get(
    '/team',
    read('manager', async (tx, t) => ({
      members: await team(tx, t.id),
      duaWhatsappManagers: await duaManagers(tx, t.id),
    })),
  );

  // the owner's per-store switch: managers may talk to Duá by WhatsApp (default on)
  admin.patch(
    '/team/settings',
    write('owner', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      if (typeof body.duaWhatsappManagers !== 'boolean')
        throw new HttpError(422, 'BAD_REQUEST', 'duaWhatsappManagers must be a boolean', {
          field: 'duaWhatsappManagers',
        });
      const on = body.duaWhatsappManagers;
      await tx`insert into store_settings (tenant_id) values (${t.id}) on conflict do nothing`;
      const before = await duaManagers(tx, t.id);
      await tx`update store_settings set dua_whatsapp_managers = ${on} where tenant_id = ${t.id}`;
      if (before !== on)
        await audit(tx, t.id, m, {
          action: 'team.settings',
          entity: 'member',
          summary: on
            ? 'ligou o Duá pelo WhatsApp para gerentes'
            : 'desligou o Duá pelo WhatsApp para gerentes',
          before: { duaWhatsappManagers: before },
          after: { duaWhatsappManagers: on },
        });
      await emitAdminTx(tx, t.id, 'team');
      return { status: 200, body: { duaWhatsappManagers: on } };
    }),
  );

  // Invite = add the phone (and optionally an email), then tell the person: WhatsApp from the
  // platform's number, and the email when given. They sign in with a code on their own phone.
  // The email is a sign-in factor, so like Perfil's it waits in pending_email until the link the
  // invite carries is opened; a re-added member's old address goes too (it may not be theirs now).
  admin.post(
    '/team',
    inviteRoute(
      write('owner', async (tx, t, m, c) => {
        const body = await bodyJson(c);
        const name = text(body.name, 'name', 80, 2);
        const phone = validAdminPhone(body.phone);
        if (!phone)
          throw new HttpError(422, 'INVALID_PHONE', 'type the phone with DDD', { field: 'phone' });
        const role = oneOf(body.role, 'role', ROLES);
        let email: string | null = null;
        if (body.email !== undefined && body.email !== null && body.email !== '') {
          email = validAdminEmail(body.email);
          if (!email)
            throw new HttpError(422, 'BAD_REQUEST', 'email looks wrong', { field: 'email' });
        }
        const existing = (
          await tx<{ id: string; status: string }[]>`
            select id, status from merchant_users where tenant_id = ${t.id} and phone = ${phone}
          `
        )[0];
        if (existing?.status === 'active')
          throw new HttpError(409, 'MEMBER_EXISTS', 'this phone is already on the team', {
            field: 'phone',
          });
        const memberId = existing
          ? (
              await tx<{ id: string }[]>`
                update merchant_users set name = ${name}, role = ${role}, status = 'active', invited_by = ${m.userId},
                  email = null, pending_email = ${email}, invite_sent_at = null, invite_channels = '{}', invite_error = null
                where id = ${existing.id} returning id
              `
            )[0]!.id
          : (
              await tx<{ id: string }[]>`
                insert into merchant_users (tenant_id, name, phone, pending_email, role, invited_by)
                values (${t.id}, ${name}, ${phone}, ${email}, ${role}, ${m.userId})
                returning id
              `
            )[0]!.id;
        await audit(tx, t.id, m, {
          action: 'team.add',
          entity: 'member',
          entityId: phone.slice(-4),
          summary: `adicionou ${name} como ${ROLE_LABEL[role]}`,
        });
        await emitAdminTx(tx, t.id, 'team');
        const job: InviteJob = {
          memberId,
          name,
          phone,
          email,
          confirm: true,
          inviter: m.name,
          store: t.name,
        };
        return { status: 201, body: { job } };
      }),
    ),
  );

  admin.post(
    '/team/:id/invite',
    inviteRoute(
      write('owner', async (tx, t, m, c) => {
        const id = uuidParam(c, 'id');
        const cur = (
          await tx<
            { name: string; phone: string; email: string | null; pending_email: string | null }[]
          >`
            select name, phone, email, pending_email from merchant_users
            where tenant_id = ${t.id} and id = ${id} and status = 'active'
          `
        )[0];
        if (!cur) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'member not found');
        const recent = (
          await tx<{ n: number }[]>`
            select count(*)::int as n from audit_log
            where tenant_id = ${t.id} and action = 'team.invite' and entity_id = ${id}
              and at > now() - interval '1 hour'
          `
        )[0]!.n;
        if (recent >= INVITES_PER_HOUR)
          throw new HttpError(429, 'RATE_LIMITED', 'this invite was sent 3 times in the last hour');
        await audit(tx, t.id, m, {
          action: 'team.invite',
          entity: 'member',
          entityId: id,
          summary: `reenviou o convite para ${cur.name}`,
        });
        const job: InviteJob = {
          memberId: id,
          name: cur.name,
          phone: cur.phone,
          email: cur.pending_email ?? cur.email,
          confirm: cur.pending_email !== null,
          inviter: m.name,
          store: t.name,
        };
        return { status: 200, body: { job } };
      }),
    ),
  );

  // a role/removal change is visible only once the claim commits: clearing the gate cache inside
  // the tx would let a request in that window cache the old row for GATE_TTL_MS
  const thenForgetGate =
    (h: ReturnType<typeof write>) =>
    async (c: AdminCtx): Promise<Response> => {
      try {
        return await h(c);
      } finally {
        forgetGate();
      }
    };

  admin.patch(
    '/team/:id',
    thenForgetGate(
      write('owner', async (tx, t, m, c) => {
        const id = uuidParam(c, 'id');
        const body = await bodyJson(c);
        await lockOwners(tx, t.id);
        const cur = (
          await tx<{ name: string; role: keyof typeof ROLE_LABEL }[]>`
          select name, role from merchant_users where tenant_id = ${t.id} and id = ${id} and status = 'active'
        `
        )[0];
        if (!cur) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'member not found');
        const role = body.role === undefined ? cur.role : oneOf(body.role, 'role', ROLES);
        const name = body.name === undefined ? cur.name : text(body.name, 'name', 80, 2);
        if (cur.role === 'owner' && role !== 'owner' && (await owners(tx, t.id, id)) === 0)
          throw new HttpError(409, 'LAST_OWNER', 'the store needs at least one owner');
        await tx`update merchant_users set role = ${role}, name = ${name} where id = ${id}`;
        await audit(tx, t.id, m, {
          action: 'team.update',
          entity: 'member',
          entityId: id,
          summary:
            role !== cur.role
              ? `mudou ${name} de ${ROLE_LABEL[cur.role]} para ${ROLE_LABEL[role]}`
              : `renomeou ${cur.name} para ${name}`,
        });
        await emitAdminTx(tx, t.id, 'team');
        return { status: 200, body: { members: await team(tx, t.id) } };
      }),
    ),
  );

  admin.delete(
    '/team/:id',
    thenForgetGate(
      write('owner', async (tx, t, m, c) => {
        const id = uuidParam(c, 'id');
        await lockOwners(tx, t.id);
        const cur = (
          await tx<{ name: string; role: string }[]>`
          select name, role from merchant_users where tenant_id = ${t.id} and id = ${id} and status = 'active'
        `
        )[0];
        if (!cur) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'member not found');
        if (cur.role === 'owner' && (await owners(tx, t.id, id)) === 0)
          throw new HttpError(409, 'LAST_OWNER', 'the store needs at least one owner');
        await tx`update merchant_users set status = 'revoked' where id = ${id}`;
        // access ends now, on every device
        await tx`update merchant_sessions set revoked_at = now() where tenant_id = ${t.id} and user_id = ${id} and revoked_at is null`;
        await tx`delete from push_subscriptions where tenant_id = ${t.id} and user_id = ${id}`;
        await audit(tx, t.id, m, {
          action: 'team.remove',
          entity: 'member',
          entityId: id,
          summary: `removeu o acesso de ${cur.name}`,
        });
        await emitAdminTx(tx, t.id, 'team');
        return { status: 200, body: { members: await team(tx, t.id) } };
      }),
    ),
  );

  admin.get(
    '/activity',
    read('manager', async (tx, t, _m, c) => {
      const before = Number(c.req.query('before'));
      const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
      const entity = c.req.query('entity');
      if (entity && !/^[a-z_]{2,30}$/.test(entity))
        throw new HttpError(400, 'BAD_REQUEST', 'bad entity');
      const kind = c.req.query('kind');
      if (kind && !Object.hasOwn(ACTIVITY_KINDS, kind))
        throw new HttpError(
          400,
          'BAD_REQUEST',
          `kind must be one of ${Object.keys(ACTIVITY_KINDS).join(', ')}`,
        );
      const tz = await storeTz(tx, t.id);
      const rows = await tx<
        {
          id: string;
          actor: string;
          action: string;
          entity: string;
          entityId: string | null;
          summary: string;
          at: Date;
          before: unknown;
          after: unknown;
        }[]
      >`
        select id, actor_label as actor, action, entity, entity_id as "entityId", summary, at, before, after
        from audit_log where tenant_id = ${t.id}
          ${Number.isSafeInteger(before) && before > 0 ? tx`and id < ${before}` : tx``}
          ${entity ? tx`and entity = ${entity}` : tx``}
          ${kind ? tx`and entity = any(${ACTIVITY_KINDS[kind as ActivityKind]}::text[])` : tx``}
        order by id desc limit ${limit}
      `;
      return {
        // before/after stay here: they hold whatever a route logged; the feed gets the readable diff
        entries: rows.map(({ before: b, after: a, ...e }) => ({ ...e, ...auditChanges(b, a, tz) })),
        next: rows.length === limit ? Number(rows.at(-1)!.id) : null,
      };
    }),
  );
}
