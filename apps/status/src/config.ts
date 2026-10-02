// What status.vendua.com.br checks, from outside the VPS (a GitHub runner). Hosts can be
// overridden per run; the defaults are production.

export type ComponentId = 'lojas' | 'pedidos' | 'painel' | 'site';

export interface CheckSpec {
  url: string;
  /** the body must contain this */
  text?: string;
  /** the parsed JSON body must pass this */
  json?: (body: unknown) => boolean;
}

export interface ComponentSpec {
  id: ComponentId;
  name: string;
  hint: string;
  checks: CheckSpec[];
  /** the checks are the same probe on different stores: one answering is enough */
  anyOf?: boolean;
}

export interface Config {
  publicUrl: string;
  adminOrigin: string;
  components: ComponentSpec[];
  /** Core's public incidents feed (GET /admin/v1/status) */
  incidentsUrl: string;
}

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** `probes`: store hosts from Core's feed. STATUS_STORE_HOST pins a single one instead. */
export function config(
  env: Record<string, string | undefined> = process.env,
  probes: string[] = [],
): Config {
  const hosts = env.STATUS_STORE_HOST ? [env.STATUS_STORE_HOST] : probes;
  const admin = (env.STATUS_ADMIN_ORIGIN || 'https://painel.vendua.com.br').replace(/\/$/, '');
  const site = (env.STATUS_SITE_ORIGIN || 'https://vendua.com.br').replace(/\/$/, '');
  return {
    publicUrl: (env.STATUS_PUBLIC_URL || 'https://status.vendua.com.br').replace(/\/$/, ''),
    adminOrigin: admin,
    incidentsUrl: `${admin}/admin/v1/status`,
    components: [
      {
        id: 'lojas',
        name: 'Lojas',
        hint: 'As lojas abrem para os clientes.',
        // the edge injects the store's state into every page it serves
        anyOf: true,
        checks: hosts.map((h) => ({ url: `https://${h}/`, text: 'id="vendua-state"' })),
      },
      {
        id: 'pedidos',
        name: 'Pedidos',
        hint: 'Carrinho e pedidos respondem nas lojas.',
        // Core through the edge; a stale answer (x-vendua-edge-stale) fails in check.ts
        anyOf: true,
        checks: hosts.map((h) => ({
          url: `https://${h}/storefront/v1/state`,
          json: (b: unknown) => obj(b) && obj(b.store) && typeof b.store.status === 'string',
        })),
      },
      {
        id: 'painel',
        name: 'Painel',
        hint: 'O painel do lojista, no celular e no computador.',
        checks: [
          { url: `${admin}/admin/` },
          // public and reads the database: Core answers through the admin's proxy
          {
            url: `${admin}/admin/v1/signup/plans`,
            json: (b) => obj(b) && Array.isArray(b.plans),
          },
        ],
      },
      {
        id: 'site',
        name: 'Site da Venduá',
        hint: site.replace(/^https?:\/\//, ''),
        checks: [{ url: `${site}/` }],
      },
    ],
  };
}
