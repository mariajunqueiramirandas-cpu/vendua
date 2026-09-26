import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import {
  contrastProblems,
  validateTemplate,
  validateTokens,
  type ArtifactManifest,
  type PageId,
  type StorefrontTokens,
  type TemplateSet,
} from '@vendua/templates';
import { readTemplatesDir } from '@vendua/templates/node';
import kernelPkg from '../package.json' with { type: 'json' };
import type { StorefrontConfig } from './config.ts';
import { SDK_SCHEMAS, catalogOf } from './sdk/schemas.ts';

// `vendua()` — the only sanctioned build path for a storefront (03 — build):
//  • provides `virtual:vendua/storefront` = { sections (glob of sections/*.tsx), snapshot }
//  • snapshot = the store's live templates + tokens pulled from Core when
//    VENDUA_CORE_ORIGIN is set (tokens are store data; an edit triggers a rebuild),
//    else the repo's templates/ + vendua.config tokens
//  • refuses to build tokens that fail WCAG AA on default surfaces
//  • emits dist/vendua-manifest.json (Kernel × Contract × Core API + section catalog)

export const KERNEL_VERSION: string = kernelPkg.version;
export const CORE_API = { storefront: 1, checkout: 1 } as const;

const VIRTUAL = 'virtual:vendua/storefront';
const RESOLVED = '\0vendua-storefront';

export interface VenduaPluginOptions {
  config: StorefrontConfig;
  /** Core origin to pull templates/tokens from (default: env VENDUA_CORE_ORIGIN) */
  coreOrigin?: string;
  /** Host header that resolves this store's tenant (default: env VENDUA_TENANT_HOST, else localhost:<dev port>) */
  tenantHost?: string;
}

interface Snapshot {
  templates: TemplateSet;
  tokens: StorefrontTokens | null;
  source: 'core' | 'repo';
}

function getJson(origin: string, path: string, host: string): Promise<unknown> {
  const u = new URL(path, origin);
  const req = u.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const r = req(
      u,
      // Host is how Core resolves the tenant — node's fetch won't let us set it
      { headers: { host, accept: 'application/json' }, timeout: 10_000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 400)
            return reject(new Error(`${res.statusCode} ${body.slice(0, 200)}`));
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    r.on('timeout', () => r.destroy(new Error('timed out')));
    r.on('error', reject);
    r.end();
  });
}

/** Static read of `defineSection/defineBlock({ type, category, areas })` — the
 *  manifest needs area specs without executing store code (lint keeps them literal). */
export function extractSchemas(
  src: string,
): Record<
  string,
  { areas?: Record<string, { accepts: string[]; max?: number }>; category?: string }
> {
  const out: Record<
    string,
    { areas?: Record<string, { accepts: string[]; max?: number }>; category?: string }
  > = {};
  const balanced = (text: string, from: number, open: string, close: string): string | null => {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) return text.slice(from, i + 1);
    }
    return null;
  };
  for (const m of src.matchAll(/define(Section|Block)\s*\(/g)) {
    const call = balanced(src, m.index! + m[0].length - 1, '(', ')');
    if (!call) continue;
    const type = /\btype\s*:\s*['"]((?:sdk|store):[a-z0-9-]+)['"]/.exec(call)?.[1];
    if (!type) continue;
    if (m[1] === 'Block') {
      const category = /\bcategory\s*:\s*['"]([a-z0-9-]+)['"]/.exec(call)?.[1];
      out[type] = category ? { category } : {};
      continue;
    }
    const at = /\bareas\s*:\s*\{/.exec(call);
    const areasSrc = at ? balanced(call, at.index + at[0].length - 1, '{', '}') : null;
    let areas: Record<string, { accepts: string[]; max?: number }> | undefined;
    if (areasSrc && /^[\s\w'"{}[\],:.-]*$/.test(areasSrc)) {
      try {
        areas = new Function(`"use strict"; return (${areasSrc});`)() as typeof areas;
      } catch {
        areas = undefined;
      }
    }
    out[type] = areas ? { areas } : {};
  }
  return out;
}

const hash = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(v ?? null))
    .digest('hex')
    .slice(0, 16);

export function vendua(opts: VenduaPluginOptions): Plugin {
  let root = process.cwd();
  let devPort: number | undefined;
  let snapshot: Snapshot | null = null;
  let slug = 'unknown';

  const load = async (): Promise<Snapshot> => {
    const repo = readTemplatesDir(join(root, 'templates'));
    const origin = opts.coreOrigin ?? process.env.VENDUA_CORE_ORIGIN;
    if (!origin) return { templates: repo, tokens: null, source: 'repo' };
    const host = opts.tenantHost ?? process.env.VENDUA_TENANT_HOST ?? `localhost:${devPort ?? 80}`;
    let design: { templates?: Record<string, unknown>; tokens?: unknown };
    try {
      design = (await getJson(origin, '/storefront/v1/design', host)) as typeof design;
    } catch (e) {
      // an explicit Core pull that fails must not ship stale data silently
      throw new Error(
        `vendua: could not pull design from ${origin} (Host ${host}): ${(e as Error).message}`,
      );
    }
    const core: TemplateSet = {};
    for (const [page, t] of Object.entries(design.templates ?? {})) {
      const v = validateTemplate(t, page as PageId);
      if (!v.ok)
        throw new Error(`vendua: Core template '${page}' is invalid: ${v.errors.join('; ')}`);
      core[page as PageId] = v.template;
    }
    let tokens: StorefrontTokens | null = null;
    if (design.tokens) {
      const v = validateTokens(design.tokens);
      if (!v.ok) throw new Error(`vendua: Core tokens are invalid: ${v.errors.join('; ')}`);
      tokens = v.tokens;
    }
    const hasCore = Object.keys(core).length > 0 || tokens !== null;
    return { templates: { ...repo, ...core }, tokens, source: hasCore ? 'core' : 'repo' };
  };

  return {
    name: 'vendua',
    enforce: 'pre',
    configResolved(c) {
      root = c.root;
      devPort = c.server.port;
      try {
        slug = (
          JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string }
        ).name.replace(/^@vendua\/storefront-/, '');
      } catch {
        /* keep 'unknown' */
      }
    },
    async buildStart() {
      try {
        snapshot = await load();
      } catch (e) {
        this.error((e as Error).message);
      }
      const effective = snapshot!.tokens ?? opts.config.tokens;
      const problems = contrastProblems(effective);
      if (problems.length)
        this.error(
          `vendua: design tokens fail WCAG AA on Kernel default surfaces (release blocked):\n  ${problems.join('\n  ')}`,
        );
      const dir = join(root, 'templates');
      if (existsSync(dir)) for (const f of readdirSync(dir)) this.addWatchFile(join(dir, f));
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const s = snapshot ?? { templates: {}, tokens: null, source: 'repo' };
      return [
        `export const snapshot = ${JSON.stringify(s)};`,
        `export const sections = import.meta.glob('/sections/*.tsx', { eager: true });`,
        `export default { snapshot, sections };`,
      ].join('\n');
    },
    async handleHotUpdate(ctx) {
      if (!ctx.file.startsWith(join(root, 'templates'))) return;
      try {
        snapshot = await load();
      } catch (e) {
        ctx.server.config.logger.error((e as Error).message);
        return;
      }
      const mod = ctx.server.moduleGraph.getModuleById(RESOLVED);
      if (mod) {
        ctx.server.moduleGraph.invalidateModule(mod);
        ctx.server.ws.send({ type: 'full-reload' });
      }
      return [];
    },
    generateBundle() {
      const s = snapshot ?? { templates: {}, tokens: null, source: 'repo' as const };
      const sections: ArtifactManifest['sections'] = catalogOf(SDK_SCHEMAS);
      const secDir = join(root, 'sections');
      if (existsSync(secDir))
        for (const f of readdirSync(secDir).filter((x) => x.endsWith('.tsx')))
          Object.assign(sections, extractSchemas(readFileSync(join(secDir, f), 'utf8')));
      const manifest: ArtifactManifest = {
        manifestVersion: 1,
        storefront: slug,
        contract: opts.config.contract,
        kernel: KERNEL_VERSION,
        coreApi: { ...CORE_API },
        builtAt: new Date().toISOString(),
        templates: {
          source: s.source,
          pages: Object.keys(s.templates).sort(),
          hash: hash(s.templates),
        },
        tokens: { source: s.tokens ? 'core' : 'repo', hash: hash(s.tokens ?? opts.config.tokens) },
        sections,
        overrides: Object.keys(opts.config.overrides ?? {}).sort(),
      };
      this.emitFile({
        type: 'asset',
        fileName: 'vendua-manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}
