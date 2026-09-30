import { storeOrigin } from '../platform/store-origin.ts';
import type { AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';

// Conta e plano (A6). CORE-BILL replaces this with plans, the subscription, invoices,
// custom domains and the PRO+ site request.
export function mountAccount(d: AdminDeps) {
  const { admin } = d;
  const { read } = handlers(d);

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
