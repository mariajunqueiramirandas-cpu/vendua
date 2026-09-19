/**
 * Static contract checks K01–K04 (docs/architecture/10-qa-pipeline.md).
 * K05 lives in k05.ts — it is a repo-diff check, not a storefront-source check.
 *
 * Deliberately boring: source scans + package.json allow-lists + one bun
 * subprocess that actually evaluates vendua.config.ts so override keys are
 * read from the real export, not regexed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { SLOT_KEYS } from '@vendua/kernel/config';
import type { CheckResult } from './report.ts';

const SRC_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'qa-report', '.git', '.vite']);

// Contract allow-list (03-storefront-contract.md): calibrated against the
// storefront package.jsons in this repo. Runtime deps are a closed set;
// devDeps allow build tooling + @types/* only.
const DEP_ALLOW = new Set([
  'react',
  'react-dom',
  'react-router-dom',
  '@vendua/kernel',
  'lucide-react',
  'qrcode',
  'gsap',
  'three',
  'lenis',
  'framer-motion',
  'motion',
]);
const DEP_ALLOW_PREFIX = ['@react-three/'];
const DEVDEP_ALLOW = new Set(['typescript', 'vite', '@vitejs/plugin-react']);
const DEVDEP_ALLOW_PREFIX = ['@types/'];

// Kernel subpath exports a storefront may legally import (kernel package.json
// exports map). Everything deeper is a contract violation.
const KERNEL_IMPORT_ALLOW = new Set([
  '@vendua/kernel',
  '@vendua/kernel/config',
  '@vendua/kernel/styles.css',
]);

const RESERVED_ROUTE_PREFIXES = ['v1', 'storefront', 'checkout/v1', 'control'];

// Contract v1 (03): the dev proxy may only forward the reserved API
// prefixes, in object form — vite's string shorthand forces
// `changeOrigin: true` and rewrites the Host header tenant resolution
// depends on. Only the versioned mounts are legal: a bare '/storefront'
// or '/checkout' proxy would swallow same-named page routes.
const PROXY_KEY_ALLOW = new Set(['/storefront/v1', '/checkout/v1', '/v1', '/control']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (SRC_EXT.has(p.slice(p.lastIndexOf('.')))) {
        // Root-level *.config.* is infrastructure, not storefront source —
        // vite.config.ts legitimately mentions API prefixes in proxy config.
        if (d === dir && /\.config\.[^.]+$/.test(name)) continue;
        out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}

async function run(
  cmd: string[],
  cwd: string,
  timeoutMs = 180_000,
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timer);
  return { code, output: `${stdout}\n${stderr}`.trim() };
}

function fail(id: string, title: string, detail: string): CheckResult {
  return { id, title, status: 'fail', detail };
}
function pass(id: string, title: string, detail?: string): CheckResult {
  return { id, title, status: 'pass', ...(detail ? { detail } : {}) };
}

async function k01(dir: string): Promise<CheckResult> {
  const id = 'K01';
  const title = 'vendua.config.ts type-checks; override keys ⊆ SLOT_KEYS';
  const cfg = join(dir, 'vendua.config.ts');
  if (!existsSync(cfg)) return fail(id, title, 'vendua.config.ts missing');

  // Whole-package typecheck — the config is only meaningful if it compiles in
  // its own project (kernel types, override factories, storefront tsconfig).
  const pkgPath = join(dir, 'package.json');
  const hasCheck =
    existsSync(pkgPath) && Boolean((JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {}).check);
  const t = hasCheck
    ? await run(['bun', 'run', 'check'], dir)
    : await run(['bunx', 'tsc', '--noEmit', '-p', 'tsconfig.json'], dir);
  if (t.code !== 0)
    return fail(
      id,
      title,
      `typecheck failed (${hasCheck ? 'bun run check' : 'tsc'}):\n${t.output.slice(-3000)}`,
    );

  // Evaluate the real module in the storefront's own resolution context and
  // read the override keys off the default export.
  const ev = await run(
    [
      'bun',
      '-e',
      'const m = await import(process.env.VENDUA_CFG); const c = m.default ?? m; ' +
        'console.log(JSON.stringify({ contract: c.contract ?? null, keys: Object.keys(c.overrides ?? {}) }));',
    ],
    dir,
    60_000,
    { VENDUA_CFG: cfg },
  );
  if (ev.code !== 0)
    return fail(id, title, `vendua.config.ts failed to evaluate:\n${ev.output.slice(-2000)}`);
  const parsed = JSON.parse(ev.output.trim().split('\n').pop() ?? '{}') as {
    contract: number | null;
    keys: string[];
  };
  if (parsed.contract !== 1)
    return fail(id, title, `contract major must be 1; got ${JSON.stringify(parsed.contract)}`);
  const bad = parsed.keys.filter((k) => !(SLOT_KEYS as readonly string[]).includes(k));
  if (bad.length)
    return fail(
      id,
      title,
      `override keys not in SLOT_KEYS (contract v${parsed.contract}): ${bad.join(', ')}`,
    );
  return pass(id, title, `contract=1, overrides=[${parsed.keys.join(', ') || 'none'}] all valid`);
}

function k02(dir: string): CheckResult {
  const id = 'K02';
  const title = 'required mounts: VenduaProvider + SystemSurfaces + v.js tag';
  const indexPath = join(dir, 'index.html');
  if (!existsSync(indexPath)) return fail(id, title, 'index.html missing');
  const html = readFileSync(indexPath, 'utf8');

  const problems: string[] = [];
  if (!/<script[^>]+src=["']\/v1\/v\.js/.test(html))
    problems.push('index.html lacks <script src="/v1/v.js">');

  // Entry = the module script in index.html; fall back to common entry names.
  const m = /<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/.exec(html);
  const candidates = [m?.[1], 'main.tsx', 'src/main.tsx', 'main.ts', 'src/main.ts']
    .filter((x): x is string => Boolean(x))
    .map((p) => join(dir, p.replace(/^\//, '')));
  const entry = candidates.find((p) => existsSync(p));
  if (!entry) {
    problems.push(`entry not found (tried: ${candidates.map((c) => basename(c)).join(', ')})`);
  } else {
    // Comments can mention the components — strip them before counting.
    const src = readFileSync(entry, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
    // Structural mount check: exactly one <VenduaProvider> element whose
    // children contain <SystemSurfaces /> before the router mount. Source-order
    // on the flat JSX text — not a full AST, but it catches the realistic
    // failure shapes: missing/duplicated mounts, surfaces outside the provider,
    // surfaces after the router.
    const provOpen = /<VenduaProvider[\s>]/.exec(src)?.index;
    const provOpens = src.match(/<VenduaProvider[\s>]/g) ?? [];
    const provClose = src.indexOf('</VenduaProvider>');
    const surf = /<SystemSurfaces[\s/>]/.exec(src)?.index;
    const surfs = src.match(/<SystemSurfaces[\s/>]/g) ?? [];
    // <Routes> is a route table, not a router mount — it can legally live in
    // a child component above the provider in source order.
    const router = /<(BrowserRouter|RouterProvider|HashRouter|MemoryRouter)[\s>]/.exec(src)?.index;

    if (!/\bVenduaProvider\b/.test(src)) problems.push('entry does not import VenduaProvider');
    if (provOpen === undefined) problems.push('entry does not render <VenduaProvider>');
    else if (provOpens.length !== 1)
      problems.push(`entry renders ${provOpens.length} <VenduaProvider> elements — exactly one`);
    else if (provClose === -1)
      problems.push('<VenduaProvider> never closes — SystemSurfaces must live inside it');
    else {
      if (surf === undefined) problems.push('entry does not render <SystemSurfaces />');
      else if (surfs.length !== 1)
        problems.push(`entry renders ${surfs.length} <SystemSurfaces> — exactly one`);
      else if (surf < provOpen || surf > provClose)
        problems.push('<SystemSurfaces /> must render inside <VenduaProvider>');
      else if (router === undefined)
        problems.push('no router mount inside <VenduaProvider> — the app shell is required');
      else if (!(surf < router && router < provClose))
        problems.push('<SystemSurfaces /> must mount before the router inside the provider');
    }
  }
  if (problems.length) return fail(id, title, problems.join('\n'));
  return pass(id, title);
}

function k03(dir: string): CheckResult {
  const id = 'K03';
  const title = 'no direct fetch/axios/XHR; no deep kernel imports; deps ⊆ allow-list';
  const problems: string[] = [];

  for (const file of sourceFiles(dir)) {
    const rel = file.slice(dir.length + 1);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const loc = `${rel}:${i + 1}`;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (/\bfetch\s*\(/.test(line))
        problems.push(`${loc}: direct fetch() — use @vendua/kernel api`);
      if (/\baxios\b/.test(line)) problems.push(`${loc}: axios — use @vendua/kernel api`);
      if (/\bXMLHttpRequest\b/.test(line))
        problems.push(`${loc}: XMLHttpRequest — use @vendua/kernel api`);
      for (const imp of line.matchAll(/from\s+['"](@vendua\/kernel[^'"]*)['"]/g)) {
        if (!KERNEL_IMPORT_ALLOW.has(imp[1]!))
          problems.push(
            `${loc}: deep import ${imp[1]} — allowed: ${[...KERNEL_IMPORT_ALLOW].join(', ')}`,
          );
      }
      for (const imp of line.matchAll(/import\s*\(\s*['"](@vendua\/kernel[^'"]*)['"]/g)) {
        if (!KERNEL_IMPORT_ALLOW.has(imp[1]!))
          problems.push(`${loc}: deep dynamic import ${imp[1]}`);
      }
    });
  }

  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!DEP_ALLOW.has(dep) && !DEP_ALLOW_PREFIX.some((p) => dep.startsWith(p)))
        problems.push(`package.json dependency ${dep} not in contract allow-list`);
    }
    for (const dep of Object.keys(pkg.devDependencies ?? {})) {
      if (!DEVDEP_ALLOW.has(dep) && !DEVDEP_ALLOW_PREFIX.some((p) => dep.startsWith(p)))
        problems.push(
          `package.json devDependency ${dep} not in allow-list (typescript/vite/@types/*)`,
        );
    }
  } else {
    problems.push('package.json missing');
  }

  if (problems.length) return fail(id, title, problems.join('\n'));
  return pass(id, title);
}

function k04(dir: string): CheckResult {
  const id = 'K04';
  const title = 'no page routes under reserved API prefixes; no literal commerce-endpoint calls';
  const problems: string[] = [];

  for (const file of sourceFiles(dir)) {
    const rel = file.slice(dir.length + 1);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const loc = `${rel}:${i + 1}`;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

      for (const m of line.matchAll(/\bpath\s*[:=]\s*['"`]([^'"`]+)['"`]/g)) {
        const p = m[1]!.replace(/^\/+/, '');
        if (RESERVED_ROUTE_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`)))
          problems.push(`${loc}: route path '${m[1]}' mounts under reserved API prefix`);
      }
      // Literal calls into commerce API paths — any call shape (fetch, axios,
      // custom wrappers). /v1/v.js in index.html is a script tag, not a call.
      for (const m of line.matchAll(
        /\(\s*[`'"]([^`'"]*\/(?:checkout\/v1|storefront\/v1|control\/v1)[^`'"]*)[`'"]/g,
      )) {
        problems.push(
          `${loc}: literal call to '${m[1]}' — commerce calls go through @vendua/kernel`,
        );
      }
    });
  }

  if (problems.length) return fail(id, title, problems.join('\n'));
  return pass(id, title);
}

async function k06(dir: string): Promise<CheckResult> {
  const id = 'K06';
  const title = 'vite proxy: object form only, keys ⊆ reserved API prefixes';
  const vitePath = join(dir, 'vite.config.ts');
  if (!existsSync(vitePath)) return fail(id, title, 'vite.config.ts missing');

  // Evaluate the real config (defineConfig may be an object, function, or
  // promise) and read server.proxy off the resolved value.
  const ev = await run(
    [
      'bun',
      '-e',
      'const m = await import(process.env.VITE_CFG); let v = m.default ?? m; ' +
        'if (typeof v === "function") v = await v({ command: "serve", mode: "development" }); ' +
        'v = await v; console.log(JSON.stringify(v?.server?.proxy ?? null));',
    ],
    dir,
    60_000,
    { VITE_CFG: vitePath },
  );
  if (ev.code !== 0)
    return fail(id, title, `vite.config.ts failed to evaluate:\n${ev.output.slice(-2000)}`);
  const proxy = JSON.parse(ev.output.trim().split('\n').pop() ?? 'null') as Record<
    string,
    unknown
  > | null;

  const problems: string[] = [];
  if (proxy === null) {
    problems.push(
      'server.proxy missing — the storefront must proxy the reserved API prefixes to Core',
    );
  } else {
    for (const [key, value] of Object.entries(proxy)) {
      if (!PROXY_KEY_ALLOW.has(key)) {
        problems.push(
          `proxy key '${key}' is not a reserved API prefix (allowed: ${[...PROXY_KEY_ALLOW].join(', ')}) — ` +
            `a bare '/checkout' or other page-path key swallows storefront routes`,
        );
        continue;
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        problems.push(
          `proxy '${key}' uses string shorthand — it forces changeOrigin:true and rewrites the ` +
            `Host header tenant resolution needs. Use { target, changeOrigin: false }`,
        );
        continue;
      }
      if ((value as { changeOrigin?: unknown }).changeOrigin === true) {
        problems.push(
          `proxy '${key}' sets changeOrigin:true — Host rewrites break tenant resolution`,
        );
      }
    }
  }
  if (problems.length) return fail(id, title, problems.join('\n'));
  return pass(id, title);
}

export async function runStatic(storefrontDir: string): Promise<CheckResult[]> {
  const dir = resolve(storefrontDir);
  if (!existsSync(dir)) {
    return [
      fail(
        'K01',
        'vendua.config.ts type-checks; override keys ⊆ SLOT_KEYS',
        `directory missing: ${dir}`,
      ),
    ];
  }
  const results: CheckResult[] = [];
  results.push(await k01(dir));
  results.push(k02(dir));
  results.push(k03(dir));
  results.push(k04(dir));
  results.push(await k06(dir));
  return results;
}
