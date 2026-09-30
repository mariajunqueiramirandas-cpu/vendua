import type { StorefrontTokens, TemplateSet } from '@vendua/templates';
import type { DerivedStatus, StoreSettingsRow } from './store.ts';

/** Core-side producer of the notices[] SDUI payload — new kinds must render through the Kernel's generic path (05-system-surfaces.md). */

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
  /** `?design=1` (the edge's injection, Kernel 1.10): the live templates and tokens */
  templates?: TemplateSet;
  tokens?: StorefrontTokens | null;
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
      body:
        settings?.pause_message ??
        (derived.resumesAt
          ? `Voltamos a aceitar pedidos ${formatResume(derived.resumesAt, tz)}.`
          : 'Voltamos a aceitar pedidos em breve.'),
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
      body:
        settings?.closed_message ??
        (derived.resumesAt
          ? `Abrimos ${formatResume(derived.resumesAt, tz)}. Você já pode montar sua sacola.`
          : 'Estamos fechados no momento.'),
      dismissible: true,
      priority: 50,
      // resumesAt in payload lets specialized slots restyle the countdown without parsing pt-BR copy
      ...(derived.resumesAt ? { payload: { resumesAt: derived.resumesAt } } : {}),
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

  // high_demand (Phase 1b): a kind no Kernel knows specially — it reaches every
  // storefront, rebuilt or not, through the generic system.Notice path
  if (settings?.demand_level === 'high' && derived.status !== 'paused') {
    const prep = settings.prep_time_minutes;
    notices.push({
      id: `${tenantSlug}:high_demand`,
      kind: 'high_demand',
      severity: 'warning',
      title: 'Muitos pedidos agora',
      body: `O preparo está levando mais que os ~${prep} min de sempre. Seu pedido entra na fila normalmente.`,
      dismissible: true,
      priority: 40,
      payload: { prepTimeMinutes: prep },
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
