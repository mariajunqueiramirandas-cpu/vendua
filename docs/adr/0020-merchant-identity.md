# ADR 0020: Merchant identity — phone OTP, tenant-scoped sessions, roles

- Status: Accepted (implemented 2026-09-27, Core migration 0052, Track A)
- Date: 2026-09-27

## Context

The merchant admin (`apps/admin`, [merchant-admin.md](../merchant-admin.md)) is the
store owner's product. Until now the only human identity in Core was staff (the CRM's
shared `CONTROL_SECRET` login). Merchants need their own login, which has to:

- work on a phone with no password. The pilot merchants run their business from
  WhatsApp and would not remember a password;
- let one person belong to more than one store (an owner with two brands, or an
  attendant who works for two shops) without leaking one store's data into another;
- keep tenant isolation intact: every admin query runs under `app.tenant_id` with
  RLS, the same way storefront requests do;
- tell an owner apart from the people they hire.

## Decision

**Identity is `(tenant, phone)`.** `merchant_users` has one row per person per store
(unique `tenant_id + phone`), carrying a `role` (`owner` > `manager` > `attendant`),
a `status` and per-person `prefs`. No global user table exists, so one store can
never enumerate another store's team.

**Login is a one-time code sent over WhatsApp.**

- `POST /admin/v1/auth/start { phone }` stores a sha256 of a 6-digit code in
  `merchant_login_codes`. The code lasts 10 minutes, with at most 5 codes per phone
  per hour and 5 attempts per code.
- The table is pre-tenant: it is only reachable while the `vendua.merchant_auth`
  GUC is set, inside the auth handlers.
- The response is the same whether or not the phone has a store, but only a phone
  that belongs to a store gets a code. The endpoint can't be used to discover
  merchants or to spam strangers.
- There is also a per-IP limit on the whole auth surface.
- `merchant_memberships_for_phone()` is a `SECURITY DEFINER` function and the one
  deliberate cross-tenant read. After a code verifies, it lists the stores that
  phone belongs to.
- With one store, verification opens a session. With several, it returns a
  short-lived HMAC **picker token** (10 min) and the client picks a store.
- In dev (`VENDUA_ADMIN_DEV_OTP=1`, never in production) the code comes back in
  the response, so screenshot and test scripts can sign in.

**Sessions are per tenant.**

- The cookie is `vendua_admin=<tenantId>.<sessionId>.<secret>`: `HttpOnly`,
  `SameSite=Lax`, `Path=/admin`, with 60-day sliding expiry.
- `merchant_sessions` stores only the sha256 of the secret. The cookie names its
  tenant, so the session lookup already runs under that tenant's RLS.
- Switching store mints a new session for the other tenant. It never widens the
  current one.
- Removing a person revokes their sessions in the same transaction. Every request
  re-reads the person's role and status, so a role change applies on the next tap.

**CSRF defense.** Mutations require the `x-vendua-admin: 1` header, and a
same-host `Origin` when one is sent. A cross-site form can't set the header, and
the cookie path keeps the session away from storefront and CRM routes.

**Roles gate each handler.** Handlers declare the least role they need
(`read('manager', …)`, `write('owner', …)`):

- Attendants run orders and availability.
- Managers also edit the catalog, store, marketing, appearance and reports.
- Owners also manage the team and the account.
- The last active owner of a store can't be removed or demoted.

**Every mutation writes `audit_log` in its own transaction.** The row records who
(user id plus display name), what, which entity and a pt-BR summary. It feeds
"Quem mudou o quê" in Equipe. Staff actions keep their existing trails.

**Staff provisioning.** The CRM creates the first owner through `POST
/control/v1/storefronts/:slug/merchant-users`. The owner invites everyone else
from Equipe.

## Consequences

- Whoever controls a phone number controls that person's admin access. That is the
  same trust the merchant already places in WhatsApp for their customers and orders.
  Owners can see and revoke devices (Perfil → Aparelhos conectados) and remove
  people.
- Login depends on the WhatsApp integration. If it isn't configured, dev logs the
  code, and in production the start call reports that sending failed. There is no
  e-mail fallback yet; `merchant_users.email` is stored for that follow-up.
- A person in two stores has two rows and two sessions, and switching is an explicit
  step. That costs a little UX to keep one invariant: a request only ever sees one
  tenant.
- The admin's live stream (`/admin/v1/events`, a `LISTEN` on `vendua_admin`) and web
  push both key on the session's tenant, so neither can cross stores.
