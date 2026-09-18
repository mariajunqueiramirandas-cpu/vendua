import type { DerivedStatus, StoreSettingsRow } from './store.ts';

/**
 * notices module — composeNotices, the Core-side producer of the `notices[]`
 * SDUI payload (docs/architecture/05-system-surfaces.md). New kinds MUST render
 * acceptably through the Kernel's generic path.
 */

export interface NoticeAction {
  type: string;
  label: string;
  href?: string;
  channel?: string;
  [k: string]: unknown;
}

export interface Notice {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'blocking';
  title: string;
  body?: string;
  actions?: NoticeAction[];
  payload?: Record<string, unknown>;
  dismissible: boolean;
  priority: number;
  startsAt?: string;
  endsAt?: string;
}

export interface SurfacesEnvelope {
  version: 1;
  store: { status: 'open' | 'closed' | 'paused'; resumesAt?: string };
  notices: Notice[];
}

function formatResume(iso: string | undefined, timeZone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).format(new Date(iso));
}

export function composeNotices(
  tenantSlug: string,
  settings: StoreSettingsRow | null,
  derived: DerivedStatus,
  context: { zoneMatched?: boolean } = {},
): Notice[] {
  const tz = settings?.hours?.timezone ?? 'America/Sao_Paulo';
  const notices: Notice[] = [];

  if (derived.status === 'paused') {
    notices.push({
      id: `${tenantSlug}:store_paused`,
      kind: 'store_paused',
      severity: 'blocking',
      title: 'Estamos pausados no momento',
      body: derived.resumesAt
        ? `Voltamos a aceitar pedidos ${formatResume(derived.resumesAt, tz)}.`
        : 'Voltamos a aceitar pedidos em breve.',
      dismissible: false,
      priority: 100,
      ...(derived.resumesAt ? { payload: { resumesAt: derived.resumesAt } } : {}),
    });
  } else if (derived.status === 'closed') {
    notices.push({
      id: `${tenantSlug}:store_closed`,
      kind: 'store_closed',
      severity: 'warning',
      title: 'Fechado agora',
      body: derived.resumesAt
        ? `Abrimos ${formatResume(derived.resumesAt, tz)}. Você já pode montar sua sacola.`
        : 'Estamos fechados no momento.',
      dismissible: true,
      priority: 50,
    });
  }

  if (context.zoneMatched === false && settings?.delivery_enabled) {
    notices.push({
      id: `${tenantSlug}:out_of_zone`,
      kind: 'out_of_zone',
      severity: 'warning',
      title: 'Fora da área de entrega',
      body: 'Esse endereço está fora da nossa área de entrega. Retirada continua disponível.',
      dismissible: true,
      priority: 60,
    });
  }

  if (settings?.promo) {
    notices.push({
      id: `${tenantSlug}:promo`,
      kind: 'promo',
      severity: 'info',
      title: settings.promo.title,
      ...(settings.promo.body ? { body: settings.promo.body } : {}),
      dismissible: true,
      priority: 10,
    });
  }

  return notices.sort((a, b) => b.priority - a.priority);
}
