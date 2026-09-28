import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import { audit } from './audit.ts';
import { validAdminPhone } from './auth.ts';
import { ROLES, oneOf, text, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { storeOrigin } from '../platform/store-origin.ts';

const ROLE_LABEL = { owner: 'dono', manager: 'gerente', attendant: 'atendente' } as const;

async function team(tx: Sql, tenantId: string) {
  return tx`
    select id, name, phone, email, role, status, created_at as "createdAt", last_seen_at as "lastSeenAt"
    from merchant_users where tenant_id = ${tenantId}
    order by status = 'revoked', case role when 'owner' then 0 when 'manager' then 1 else 2 end, name
  `;
}

async function owners(tx: Sql, tenantId: string, except: string) {
  return (
    await tx<{ n: number }[]>`
      select count(*)::int as n from merchant_users
      where tenant_id = ${tenantId} and role = 'owner' and status = 'active' and id <> ${except}
    `
  )[0]!.n;
}

export function mountTeam(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  admin.get(
    '/team',
    read('manager', async (tx, t) => ({ members: await team(tx, t.id) })),
  );

  // Invite = add the phone. The person signs in with a code on their own phone;
  // nobody shares a password.
  admin.post(
    '/team',
    write('owner', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      const name = text(body.name, 'name', 80, 2);
      const phone = validAdminPhone(body.phone);
      if (!phone)
        throw new HttpError(422, 'INVALID_PHONE', 'type the phone with DDD', { field: 'phone' });
      const role = oneOf(body.role, 'role', ROLES);
      const existing = (
        await tx<{ id: string; status: string }[]>`
          select id, status from merchant_users where tenant_id = ${t.id} and phone = ${phone}
        `
      )[0];
      if (existing?.status === 'active')
        throw new HttpError(409, 'MEMBER_EXISTS', 'this phone is already on the team', {
          field: 'phone',
        });
      if (existing)
        await tx`
          update merchant_users set name = ${name}, role = ${role}, status = 'active', invited_by = ${m.userId}
          where id = ${existing.id}
        `;
      else
        await tx`
          insert into merchant_users (tenant_id, name, phone, role, invited_by)
          values (${t.id}, ${name}, ${phone}, ${role}, ${m.userId})
        `;
      await audit(tx, t.id, m, {
        action: 'team.add',
        entity: 'member',
        entityId: phone.slice(-4),
        summary: `adicionou ${name} como ${ROLE_LABEL[role]}`,
      });
      await emitAdminTx(tx, t.id, 'team');
      return { status: 201, body: { members: await team(tx, t.id), signInUrl: '/admin/' } };
    }),
  );

  admin.patch(
    '/team/:id',
    write('owner', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c);
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
  );

  admin.delete(
    '/team/:id',
    write('owner', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
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
  );

  admin.get(
    '/activity',
    read('manager', async (tx, t, _m, c) => {
      const before = Number(c.req.query('before'));
      const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
      const entity = c.req.query('entity');
      if (entity && !/^[a-z]{2,20}$/.test(entity))
        throw new HttpError(400, 'BAD_REQUEST', 'bad entity');
      const rows = await tx<{ id: number }[]>`
        select id, actor_label as actor, action, entity, entity_id as "entityId", summary, at
        from audit_log where tenant_id = ${t.id}
          ${Number.isInteger(before) && before > 0 ? tx`and id < ${before}` : tx``}
          ${entity ? tx`and entity = ${entity}` : tx``}
        order by id desc limit ${limit}
      `;
      return { entries: rows, next: rows.length === limit ? Number(rows.at(-1)!.id) : null };
    }),
  );

  admin.get(
    '/account',
    read('owner', async (tx, t) => {
      const tenant = (
        await tx<
          { plan: string; created_at: string }[]
        >`select plan, created_at from tenants where id = ${t.id}`
      )[0]!;
      const domains = await tx<
        { host: string }[]
      >`select host from domains where tenant_id = ${t.id} order by host`;
      return {
        plan: { id: tenant.plan, since: tenant.created_at },
        // billing lands with Phase 3 — no invoices exist yet, and the page says so
        billing: { status: 'not_available' as const },
        address: await storeOrigin(tx, t, d.storeDomain),
        domains: domains
          .map((x) => x.host)
          .filter((h) => !h.endsWith('.localhost') && !h.startsWith('localhost')),
      };
    }),
  );
}
