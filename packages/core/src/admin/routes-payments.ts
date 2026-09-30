import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson } from '../platform/http.ts';
import { normalizePixKey, pixPayload, type PixKeyType } from '../modules/pix.ts';
import { audit } from './audit.ts';
import { isObj, oneOf, optText, text, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { loadSettings } from './routes-store.ts';

// Pagamentos (A3). CORE-PAY extends this with Mercado Pago connect, the fee statement and
// `card_online`; the Pix key and offline methods below are today's behavior.
const METHODS = ['pix', 'card_on_delivery', 'cash'] as const;

export function mountPayments(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  const paymentsView = async (tx: Sql, tenantId: string) => {
    const s = await loadSettings(tx, tenantId);
    const by = await tx<{ method: string; status: string; orders: number; cents: number }[]>`
      select payment ->> 'method' as method, payment ->> 'status' as status, count(*)::int as orders,
             coalesce(sum(total_cents), 0)::int as cents
      from orders where tenant_id = ${tenantId} and state not in ('cancelled', 'refunded')
        and placed_at > now() - interval '30 days'
      group by 1, 2
    `;
    const awaiting = await tx<
      { id: string; number: number; name: string; totalCents: number; placedAt: string }[]
    >`
      select id, number, customer ->> 'name' as name, total_cents as "totalCents", placed_at as "placedAt"
      from orders where tenant_id = ${tenantId} and payment ->> 'method' = 'pix'
        and payment ->> 'status' = 'pending' and state not in ('cancelled', 'refunded')
      order by placed_at desc limit 20
    `;
    const pix =
      s.pix_key && s.pix_key_type
        ? {
            key: s.pix_key,
            keyType: s.pix_key_type,
            beneficiary: s.pix_beneficiary ?? '',
            city: s.pix_city ?? '',
            sample: pixPayload({
              key: s.pix_key,
              keyType: s.pix_key_type as PixKeyType,
              beneficiary: s.pix_beneficiary ?? '',
              city: s.pix_city ?? s.city ?? '',
            }),
          }
        : null;
    return {
      methods: s.payment_methods ?? [...METHODS],
      pix,
      // Mercado Pago lands with Phase 3 (A3); the admin says so instead of faking it
      mercadoPago: { status: 'not_available' as const },
      last30: by,
      awaitingPix: awaiting,
    };
  };

  admin.get(
    '/payments',
    read('manager', async (tx, t) => paymentsView(tx, t.id)),
  );

  admin.patch(
    '/payments',
    write('owner', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      await loadSettings(tx, t.id);
      const changed: string[] = [];
      if (body.methods !== undefined) {
        const pm = body.methods;
        if (
          !Array.isArray(pm) ||
          pm.length === 0 ||
          !pm.every((x) => (METHODS as readonly unknown[]).includes(x))
        )
          throw new HttpError(422, 'BAD_REQUEST', 'keep at least one payment method', {
            field: 'methods',
          });
        await tx`update store_settings set payment_methods = ${tx.json([...new Set(pm as string[])])} where tenant_id = ${t.id}`;
        changed.push('formas de pagamento');
      }
      if (body.pix !== undefined) {
        if (body.pix === null) {
          await tx`update store_settings set pix_key = null, pix_key_type = null, pix_beneficiary = null, pix_city = null where tenant_id = ${t.id}`;
        } else {
          const p = isObj(body.pix) ? body.pix : {};
          const type = oneOf(p.keyType, 'keyType', [
            'cpf',
            'cnpj',
            'email',
            'phone',
            'random',
          ] as const);
          const key = normalizePixKey(text(p.key, 'key', 100, 1), type);
          if (!key)
            throw new HttpError(422, 'INVALID_PIX', 'this Pix key does not look right', {
              field: 'key',
            });
          const beneficiary = text(p.beneficiary, 'beneficiary', 25, 2);
          const city = optText(p.city, 'city', 15) ?? null;
          await tx`
            update store_settings set pix_key = ${key}, pix_key_type = ${type}, pix_beneficiary = ${beneficiary}, pix_city = ${city}
            where tenant_id = ${t.id}
          `;
        }
        changed.push('Pix');
      }
      if (!changed.length) throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      await audit(tx, t.id, m, {
        action: 'payments.update',
        entity: 'payments',
        summary: `alterou ${changed.join(' e ')}`,
      });
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: await paymentsView(tx, t.id) };
    }),
  );
}
