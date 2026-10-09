import { HttpError, bodyJson } from '../platform/http.ts';
import { DEFAULT_BUNDLE } from '../modules/fleet/deps.ts';
import { lockOpsTx, reconcileTx, setBundleTx, siteModeTx } from '../modules/fleet/deploy.ts';
import { inControlScope } from '../platform/db.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import {
  assertPage,
  currentTemplatesTx,
  currentTokensTx,
  latestBuildTx,
  rollbackTemplateTx,
  saveTemplateTx,
  saveTokensTx,
  storeBundleTx,
  templateHistoryTx,
} from '../modules/storefront-platform.ts';
import { audit } from './audit.ts';
import { int, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { storeOrigin } from '../platform/store-origin.ts';

const TEMPLATE_BODY_MAX = 160 * 1024;

const PAGE_LABEL: Record<string, string> = {
  layout: 'topo e rodapé',
  home: 'página inicial',
  catalog: 'cardápio',
  product: 'página do produto',
};

// Aparência: the same versioned template/token writes staff use, with source
// 'merchant'. Page edits are live on the next storefront poll; token edits
// queue a rebuild, which is what "publicando…" → "no ar" reports.

export function mountAppearance(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  admin.get(
    '/appearance',
    read('manager', async (tx, t) => {
      const bundle = await storeBundleTx(tx, t.id);
      const rows = await tx<
        { page: string; version: number; template: unknown; source: string; created_at: string }[]
      >`
        select distinct on (page) page, version, template, source, created_at from storefront_templates
        where tenant_id = ${t.id} and bundle = ${bundle} order by page, version desc
      `;
      const tokens = await currentTokensTx(tx, t.id, bundle);
      // releases are platform data: read with the control scope open for that one read
      const site = await inControlScope(tx, () => siteModeTx(tx, t.id, t.slug));
      const pending = await tx<{ id: number; created_at: string }[]>`
        select id, created_at from outbox
        where tenant_id = ${t.id} and topic = 'storefront.rebuild_requested' and published_at is null
        order by id desc limit 5
      `;
      const build = await latestBuildTx(tx, t.id);
      const hosts = (
        await tx<{ host: string }[]>`select host from domains where tenant_id = ${t.id}`
      ).map((r) => r.host);
      // the frame shows the real storefront: its public address in prod, the dev server locally
      const dev =
        process.env.NODE_ENV !== 'production'
          ? hosts.find((h) => /^localhost:\d+$/.test(h))
          : undefined;
      const url = await storeOrigin(tx, t, d.storeDomain);
      return {
        url,
        previewUrl: dev ? `http://${dev}` : url,
        pages: rows.map((r) => ({
          page: r.page,
          label: PAGE_LABEL[r.page] ?? r.page.replace(/^page:/, 'página '),
          version: r.version,
          template: r.template,
          source: r.source,
          updatedAt: r.created_at,
        })),
        tokens,
        publish: {
          // tokens compile into the build; pages are data and go live on their own
          state: pending.length ? 'publishing' : 'live',
          since: pending.at(-1)?.created_at ?? null,
          lastBuildAt: build?.recordedAt ?? null,
        },
        sections: build?.sections ?? {},
        site,
      };
    }),
  );

  // Site sob medida ↔ modelo padrão: the store moves to that bundle's newest release and shows
  // the layout and colors saved for it, edits on each side kept (ADR 0040)
  admin.put(
    '/appearance/site',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      const mode = body.mode;
      if (mode !== 'custom' && mode !== 'template')
        throw new HttpError(422, 'BAD_REQUEST', "mode must be 'custom' or 'template'", {
          field: 'mode',
        });
      // releases and deployments are the Control Plane's: the scope is open only for those
      // statements, and they commit with this store's rows and the idempotency claim
      const out = await inControlScope(tx, async () => {
        // the ops row lock first: two switches at once take turns, and the second is a no-op
        const ops = await lockOpsTx(tx, t.id);
        const site = await siteModeTx(tx, t.id, t.slug);
        if (!site)
          throw new HttpError(409, 'NO_CUSTOM_SITE', 'this store has no site sob medida to switch');
        if (site.mode === mode) return null;
        // a pin is staff holding a release (a rollback pins): the owner can't switch past it
        if (ops.release_policy === 'pinned')
          throw new HttpError(409, 'STORE_PINNED', "the team pinned this store's version");
        await setBundleTx(tx, t.id, mode === 'custom' ? t.slug : DEFAULT_BUNDLE);
        return reconcileTx(tx, d.fleet, t.id, {
          actor: 'lojista',
          reason:
            mode === 'custom'
              ? 'o lojista voltou para o site sob medida'
              : 'o lojista trocou para o modelo padrão',
        }).then((dep) => ({ dep }));
      });
      if (!out) return { status: 200, body: { site: { mode }, deployment: null } };
      const { dep } = out;
      await audit(tx, t.id, m, {
        action: 'appearance.site',
        entity: 'site',
        summary:
          mode === 'custom' ? 'voltou para o site sob medida' : 'trocou para o modelo padrão',
      });
      await recordStaffEventTx(
        tx,
        'site.mode_changed',
        { storeName: t.name, slug: t.slug, mode },
        { tenantId: t.id },
      );
      await emitAdminTx(tx, t.id, 'appearance');
      return {
        status: 200,
        body: { site: { mode }, deployment: dep ? { id: dep.id, status: dep.status } : null },
      };
    }),
  );

  admin.get(
    '/appearance/pages/:page/history',
    read('manager', async (tx, t, _m, c) => {
      const page = assertPage(c.req.param('page') ?? '');
      const history = await templateHistoryTx(tx, t.id, page);
      return {
        history: history.map((h) => ({
          version: h.version,
          source: h.source,
          at: h.created_at,
          // who: merchant/staff/migration → the words the merchant sees
          by: h.source.startsWith('merchant')
            ? 'você'
            : h.source.startsWith('migration')
              ? 'atualização automática'
              : h.source.startsWith('rollback')
                ? 'restauração'
                : 'equipe Venduá',
        })),
      };
    }),
  );

  admin.put(
    '/appearance/pages/:page',
    write('manager', async (tx, t, m, c) => {
      const page = assertPage(c.req.param('page') ?? '');
      const body = await bodyJson(c, TEMPLATE_BODY_MAX);
      const expectVersion =
        body.expectVersion === undefined
          ? undefined
          : int(body.expectVersion, 'expectVersion', 0, 1_000_000);
      const saved = await saveTemplateTx(tx, t.id, page, body.template, `merchant:${m.userId}`, {
        trackRemovals: true,
        ...(expectVersion !== undefined ? { expectVersion } : {}),
      });
      await audit(tx, t.id, m, {
        action: 'appearance.page',
        entity: 'page',
        entityId: page,
        summary: `publicou a ${PAGE_LABEL[page] ?? page} (versão ${saved.version})`,
      });
      await emitAdminTx(tx, t.id, 'appearance');
      return { status: 200, body: saved };
    }),
  );

  admin.post(
    '/appearance/pages/:page/restore',
    write('manager', async (tx, t, m, c) => {
      const page = assertPage(c.req.param('page') ?? '');
      const body = await bodyJson(c);
      const to = int(body.toVersion, 'toVersion', 1, 1_000_000);
      const saved = await rollbackTemplateTx(tx, t.id, page, to);
      await audit(tx, t.id, m, {
        action: 'appearance.restore',
        entity: 'page',
        entityId: page,
        summary: `restaurou a ${PAGE_LABEL[page] ?? page} para a versão ${to}`,
      });
      await emitAdminTx(tx, t.id, 'appearance');
      return { status: 200, body: saved };
    }),
  );

  admin.put(
    '/appearance/tokens',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      if (body.tokens === undefined) throw new HttpError(422, 'BAD_REQUEST', 'tokens are required');
      const saved = await saveTokensTx(tx, t.id, body.tokens, `merchant:${m.userId}`);
      await audit(tx, t.id, m, {
        action: 'appearance.tokens',
        entity: 'tokens',
        summary: `mudou as cores e fontes da loja (versão ${saved.version})`,
        after: saved.tokens,
      });
      await emitAdminTx(tx, t.id, 'appearance');
      return { status: 200, body: saved };
    }),
  );

  // pages the store has no row for yet read from the kernel defaults client-side
  admin.get(
    '/appearance/templates',
    read('manager', async (tx, t) => ({ templates: await currentTemplatesTx(tx, t.id) })),
  );
}
