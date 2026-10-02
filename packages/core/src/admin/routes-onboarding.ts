import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson } from '../platform/http.ts';
import type { StoreSettingsRow } from '../modules/store.ts';
import { segmentOr422, type Segment } from '../modules/billing/signup.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import { audit } from './audit.ts';
import { bool, isObj, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { loadSettings } from './routes-store.ts';

// Bem-vindo: where the store's setup stands (store_settings.onboarding, migration 0074), so the
// wizard resumes on any device. Signup leaves { from: 'signup' } and the segment behind.

const KEY_RE = /^[a-z_]{2,24}$/;
const MAX_SKIPPED = 20;
const BODY_MAX = 4 * 1024;

type Settings = StoreSettingsRow & { segment?: string | null; onboarding?: unknown };

export interface SetupItem {
  id: string;
  label: string;
  done: boolean;
  href: string;
}

/** The setup checklist Início and Bem-vindo share, plus the store's order count. */
export async function setupChecklist(
  tx: Sql,
  tenantId: string,
  s: StoreSettingsRow,
): Promise<{ checklist: SetupItem[]; orders: number }> {
  const counts = (
    await tx<{ withPhoto: number; zones: number; orders: number }[]>`
      select
        (select count(distinct p.id) from products p join product_media pm on pm.product_id = p.id
          where p.tenant_id = ${tenantId} and p.status <> 'archived')::int as "withPhoto",
        (select count(*) from delivery_zones where tenant_id = ${tenantId} and active)::int as zones,
        (select count(*) from orders where tenant_id = ${tenantId})::int as orders
    `
  )[0]!;
  const checklist = [
    {
      id: 'profile',
      label: 'Logo e WhatsApp da loja',
      done: !!s.logo_url && !!s.whatsapp,
      href: '/loja#perfil',
    },
    {
      id: 'hours',
      label: 'Horário de funcionamento',
      done: (s.hours?.windows?.length ?? 0) > 0,
      href: '/loja#horarios',
    },
    {
      id: 'delivery',
      label: 'Entrega ou retirada',
      // distance pricing (ADR 0024) delivers without a single zone
      done:
        (s.delivery_enabled && (counts.zones > 0 || !!s.distance_pricing)) ||
        (s.pickup_enabled && !s.delivery_enabled),
      href: '/loja#entrega',
    },
    { id: 'pix', label: 'Chave Pix para receber', done: !!s.pix_key, href: '/pagamentos' },
    {
      id: 'menu',
      label: '3 produtos com foto',
      done: counts.withPhoto >= 3,
      href: '/cardapio',
    },
    {
      id: 'first_order',
      label: 'Primeiro pedido',
      done: counts.orders > 0,
      href: '/marketing#compartilhar',
    },
  ];
  return { checklist, orders: counts.orders };
}

export interface OnboardingState {
  from: 'signup' | null;
  step: string | null;
  skipped: string[];
  finishedAt: string | null;
  dismissedAt: string | null;
}

export function onboardingOf(s: StoreSettingsRow): OnboardingState {
  const o = (s as Settings).onboarding;
  const j = isObj(o) ? o : {};
  const at = (v: unknown) => {
    const d = typeof v === 'string' ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  };
  return {
    from: j.from === 'signup' ? 'signup' : null,
    step: typeof j.step === 'string' ? j.step : null,
    skipped: Array.isArray(j.skipped)
      ? j.skipped.filter((x): x is string => typeof x === 'string')
      : [],
    finishedAt: at(j.finishedAt),
    dismissedAt: at(j.dismissedAt),
  };
}

async function onboardingView(tx: Sql, tenantId: string) {
  const s = await loadSettings(tx, tenantId);
  return {
    segment: (s as Settings).segment ?? null,
    ...onboardingOf(s),
    checklist: (await setupChecklist(tx, tenantId, s)).checklist,
  };
}

function key(v: unknown, field: string): string {
  if (typeof v !== 'string' || !KEY_RE.test(v))
    throw new HttpError(422, 'BAD_REQUEST', `${field} must be 2–24 of a-z or _`, { field });
  return v;
}

export function mountOnboarding(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  admin.get(
    '/onboarding',
    read('manager', async (tx, t) => onboardingView(tx, t.id)),
  );

  admin.patch(
    '/onboarding',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c, BODY_MAX);
      const merge: Record<string, unknown> = {};
      const drop: string[] = [];
      if (body.step !== undefined) {
        if (body.step === null) drop.push('step');
        else merge.step = key(body.step, 'step');
      }
      if (body.skipped !== undefined) {
        if (!Array.isArray(body.skipped) || body.skipped.length > MAX_SKIPPED)
          throw new HttpError(422, 'BAD_REQUEST', `skipped takes at most ${MAX_SKIPPED}`, {
            field: 'skipped',
          });
        const skipped = body.skipped.map((x) => key(x, 'skipped'));
        if (new Set(skipped).size !== skipped.length)
          throw new HttpError(422, 'BAD_REQUEST', 'skipped must not repeat', { field: 'skipped' });
        merge.skipped = skipped;
      }
      const segment: Segment | null | undefined =
        body.segment === undefined ? undefined : segmentOr422(body.segment);
      const finished = body.finished === undefined ? undefined : bool(body.finished, 'finished');
      if (finished === false)
        throw new HttpError(422, 'BAD_REQUEST', 'finished can only be true', { field: 'finished' });
      const dismissed =
        body.dismissed === undefined ? undefined : bool(body.dismissed, 'dismissed');
      if (
        !drop.length &&
        !Object.keys(merge).length &&
        segment === undefined &&
        finished === undefined &&
        dismissed === undefined
      )
        throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');

      const before = (await loadSettings(tx, t.id)) as Settings;
      const now = new Date().toISOString();
      if (dismissed) merge.dismissedAt = now;
      else if (dismissed === false) drop.push('dismissedAt');
      await tx`
        update store_settings set
          onboarding = (onboarding - ${drop}::text[]) || ${tx.json(merge as never)},
          segment = ${segment === undefined ? tx`segment` : segment}
        where tenant_id = ${t.id}
      `;
      // only the first "done" counts: a second keeps the first time and tells nobody
      const firstFinish =
        finished === true &&
        (
          await tx`
            update store_settings set onboarding = onboarding || jsonb_build_object('finishedAt', ${now}::text)
            where tenant_id = ${t.id} and not (onboarding ? 'finishedAt')
            returning 1
          `
        ).length > 0;

      // step and skipped are where the wizard stands, not store state: only these are audited
      const notes: string[] = [];
      if (segment !== undefined && segment !== (before.segment ?? null))
        notes.push(
          segment ? `marcou o segmento da loja como ${segment}` : 'tirou o segmento da loja',
        );
      if (firstFinish) notes.push('concluiu a configuração inicial da loja');
      const wasDismissed = !!onboardingOf(before).dismissedAt;
      if (dismissed === true && !wasDismissed) notes.push('dispensou o guia de configuração');
      if (dismissed === false && wasDismissed) notes.push('reabriu o guia de configuração');
      if (notes.length)
        await audit(tx, t.id, m, {
          action: 'store.onboarding',
          entity: 'store',
          summary: notes.join('; '),
          after: {
            ...(segment !== undefined ? { segment } : {}),
            ...(firstFinish ? { finishedAt: now } : {}),
            ...(dismissed !== undefined ? { dismissed } : {}),
          },
        });
      if (firstFinish)
        await recordStaffEventTx(
          tx,
          'store.onboarding',
          { step: 'setup' },
          { tenantId: t.id, dedupeKey: `onboarding:${t.id}:setup` },
        );
      return { status: 200, body: await onboardingView(tx, t.id) };
    }),
  );
}
