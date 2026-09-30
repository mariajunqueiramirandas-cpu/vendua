import type { State } from './check.ts';
import type { ComponentSpec } from './config.ts';
import { DAYS, TZ, dayOf, uptime, uptimeOver, type History, type Incident } from './history.ts';

// status.vendua.com.br: one static page, no JavaScript needed to read it. Tokens are the site's
// (site/src/lib/styles/theme.css, itself the admin's); it follows the system theme.

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
});
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const shortDayFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});

/** "14:32" today, "29 de set., 14:32" otherwise */
export const when = (iso: string, now: Date) => {
  const d = new Date(iso);
  return dayOf(d) === dayOf(now) ? timeFmt.format(d) : dateTimeFmt.format(d);
};

export const pct = (x: number) => {
  const p = Math.floor(x * 10_000) / 100;
  return `${p.toLocaleString('pt-BR', { maximumFractionDigits: p === 100 ? 0 : 2 })}%`;
};

const STATE: Record<State, { word: string; tone: Tone }> = {
  ok: { word: 'Funcionando', tone: 'success' },
  slow: { word: 'Com lentidão', tone: 'warning' },
  down: { word: 'Fora do ar', tone: 'danger' },
  unknown: { word: 'Sem verificação', tone: 'neutral' },
};

const SEVERITY: Record<Incident['severity'], { word: string; tone: Tone }> = {
  outage: { word: 'Fora do ar', tone: 'danger' },
  degraded: { word: 'Com lentidão', tone: 'warning' },
  info: { word: 'Aviso', tone: 'info' },
};

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const ICON: Record<Tone, string> = {
  success: '<path d="M32 48 L61 88 L98 34"/>',
  warning: '<path d="M64 30 V72"/><path d="M64 98 V98.5"/>',
  danger: '<path d="M40 40 L88 88"/><path d="M88 40 L40 88"/>',
  info: '<path d="M64 56 V96"/><path d="M64 32 V32.5"/>',
  neutral: '<path d="M36 64 H92"/>',
};

const icon = (t: Tone) =>
  `<svg class="icon" viewBox="0 0 128 128" aria-hidden="true">${ICON[t]}</svg>`;

export interface Summary {
  tone: Tone;
  title: string;
}

/** The headline: the worst of what the checks saw and what staff declared. */
export function summarize(h: History, specs: ComponentSpec[]): Summary {
  const states = specs.map((s) => h.components[s.id]?.state ?? 'unknown');
  const open = h.incidents.filter((i) => !i.resolvedAt);
  const down = states.filter((s) => s === 'down').length;
  if (states.every((s) => s === 'unknown') && !open.length)
    return { tone: 'neutral', title: 'Ainda sem verificação' };
  if (down && down === states.length) return { tone: 'danger', title: 'A Venduá está fora do ar' };
  if (down || open.some((i) => i.severity === 'outage'))
    return { tone: 'danger', title: 'Parte da Venduá está fora do ar' };
  if (states.includes('slow') || open.some((i) => i.severity === 'degraded'))
    return { tone: 'warning', title: 'A Venduá está com lentidão' };
  return { tone: 'success', title: 'Tudo funcionando' };
}

function bars(h: History, spec: ComponentSpec, now: Date) {
  const days = h.components[spec.id]?.days ?? [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const today = Date.parse(`${dayOf(now)}T00:00:00Z`);
  const cells: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = new Date(today - i * 86_400_000);
    const d = byDate.get(date.toISOString().slice(0, 10));
    const u = d ? uptime(d) : null;
    const tone =
      u === null
        ? 'none'
        : d!.down === 0 && d!.slow === 0
          ? 'success'
          : u >= 0.99
            ? 'warning'
            : 'danger';
    const label =
      u === null ? 'sem dados' : d!.down === 0 && d!.slow === 0 ? 'tudo certo' : `${pct(u)} no ar`;
    cells.push(`<i class="bar ${tone}" title="${shortDayFmt.format(date)}: ${label}"></i>`);
  }
  const total = uptimeOver(days);
  const aria =
    total === null
      ? 'Ainda sem histórico'
      : `No ar em ${pct(total)} das verificações dos últimos ${DAYS} dias`;
  return `
    <div class="bars" role="img" aria-label="${aria}">${cells.join('')}</div>
    <div class="scale" aria-hidden="true">
      <span><span class="wide">${DAYS} dias atrás</span><span class="narrow">${DAYS / 2} dias atrás</span></span>
      <span>${total === null ? '' : `${pct(total)} no ar`}</span>
      <span>hoje</span>
    </div>`;
}

function componentRow(h: History, spec: ComponentSpec, now: Date) {
  const c = h.components[spec.id];
  const s = STATE[c?.state ?? 'unknown'];
  const since =
    c && c.state !== 'ok' && c.state !== 'unknown' ? ` desde ${when(c.since, now)}` : '';
  return `
  <li class="component">
    <div class="row">
      <div>
        <h3>${esc(spec.name)}</h3>
        <p class="muted">${esc(spec.hint)}</p>
      </div>
      <p class="state ${s.tone}">${icon(s.tone)}<span>${s.word}${since}</span></p>
    </div>
    ${bars(h, spec, now)}
  </li>`;
}

function openIncident(i: Incident, now: Date) {
  const s = SEVERITY[i.severity];
  return `
  <article class="notice ${s.tone}" role="${i.severity === 'info' ? 'status' : 'alert'}">
    ${icon(s.tone)}
    <div>
      <h2>${esc(i.title)}</h2>
      <p class="meta">${s.word} desde ${when(i.startedAt, now)}</p>
      ${i.body ? `<p>${esc(i.body)}</p>` : ''}
    </div>
  </article>`;
}

function pastIncident(i: Incident, now: Date) {
  return `
  <li>
    <h3>${esc(i.title)}</h3>
    <p class="meta">Resolvido em ${when(i.resolvedAt!, now)}</p>
    ${i.body ? `<p class="muted">${esc(i.body)}</p>` : ''}
  </li>`;
}

export function render(h: History, specs: ComponentSpec[], adminOrigin: string, now = new Date()) {
  const sum = summarize(h, specs);
  const open = h.incidents.filter((i) => !i.resolvedAt);
  const past = h.incidents.filter((i) => i.resolvedAt);
  const checked = h.updatedAt === new Date(0).toISOString() ? null : h.updatedAt;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="refresh" content="300">
<title>Status da Venduá</title>
<meta name="description" content="Se as lojas, os pedidos, o painel e o site da Venduá estão funcionando agora, e o que aconteceu nos últimos dias.">
<meta name="theme-color" content="#f7f4ea" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0a100d" media="(prefers-color-scheme: dark)">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" href="favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="preload" href="fonts/space-grotesk-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="logo" href="https://vendua.com.br/" aria-label="Venduá">
      <svg viewBox="0 0 128 128" aria-hidden="true"><path d="M32 48 L61 88 L98 34"/></svg>
      <span>venduá<span class="dot">.</span></span>
    </a>
    <a class="link" href="${esc(adminOrigin)}/admin/">Ir para o painel</a>
  </header>

  <main>
    <section class="summary ${sum.tone}">
      <span class="badge">${icon(sum.tone)}</span>
      <div>
        <h1>${sum.title}</h1>
        <p class="muted">${
          checked
            ? `Verificado às ${timeFmt.format(new Date(checked))}, horário de Brasília. A página se atualiza sozinha.`
            : 'A primeira verificação ainda não terminou.'
        }</p>
      </div>
    </section>

    ${
      checked
        ? `<p class="notice warning stale" hidden data-updated="${checked}">${icon('warning')}<span>Esta página não se atualiza desde ${dateTimeFmt.format(new Date(checked))}. A situação pode ter mudado.</span></p>`
        : ''
    }

    ${open.map((i) => openIncident(i, now)).join('')}

    <section aria-labelledby="partes">
      <h2 id="partes" class="section-title">Agora</h2>
      <ul class="components">${specs.map((s) => componentRow(h, s, now)).join('')}</ul>
    </section>

    <section aria-labelledby="historico">
      <h2 id="historico" class="section-title">Últimos 30 dias</h2>
      ${
        past.length
          ? `<ul class="history">${past.map((i) => pastIncident(i, now)).join('')}</ul>`
          : '<p class="muted quiet">Nenhum problema registrado nos últimos 30 dias.</p>'
      }
    </section>
  </main>

  <footer class="foot">
    <p>Sua loja tem um problema que não aparece aqui? <a href="${esc(adminOrigin)}/admin/ajuda">Fale com a gente pela Ajuda do painel.</a></p>
    <p class="muted">Esta página fica fora dos servidores da Venduá, para continuar no ar mesmo quando algo para.</p>
  </footer>
</div>
<script>
  // the checker stopped (or GitHub is late): say so rather than show an old "tudo funcionando"
  var s = document.querySelector('.stale');
  if (s && Date.now() - Date.parse(s.dataset.updated) > 30 * 60 * 1000) s.hidden = false;
</script>
</body>
</html>
`;
}

const CSS = `
@font-face {
  font-family: 'Figtree Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 300 900;
  src: url(fonts/figtree-latin-wght-normal.woff2) format('woff2-variations');
}
@font-face {
  font-family: 'Space Grotesk Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 300 700;
  src: url(fonts/space-grotesk-latin-wght-normal.woff2) format('woff2-variations');
}
:root {
  --bg: #f7f4ea;
  --surface: #fffdf8;
  --surface-sunken: #efe9d8;
  --ink: #123c32;
  --ink-muted: #4f6a5e;
  --line: rgb(18 60 50 / 0.12);
  --primary: #123c32;
  --spark: #d9f875;
  --success: #1f7a4d;
  --success-soft: #ddf3e6;
  --warning: #9a5200;
  --warning-soft: #fff0d6;
  --danger: #b3261e;
  --danger-soft: #fbe4e1;
  --info: #2456b0;
  --info-soft: #e3eeff;
  --neutral: #4f6a5e;
  --neutral-soft: #efe9d8;
  --shadow-e1: 0 1px 2px rgb(18 60 50 / 0.06), 0 4px 16px rgb(18 60 50 / 0.05);
  --highlight: 0 0 #0000;
  --font-display: 'Space Grotesk Variable', system-ui, sans-serif;
  --font-sans: 'Figtree Variable', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --gutter: 16px;
  color-scheme: light;
}
@media (min-width: 768px) {
  :root { --gutter: 32px; }
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a100d;
    --surface: #131d18;
    --surface-sunken: #0c1410;
    --ink: #f7f4ea;
    --ink-muted: #9dafa4;
    --line: rgb(247 244 234 / 0.1);
    --primary: #d9f875;
    --success: #6fd39c;
    --success-soft: rgb(111 211 156 / 0.14);
    --warning: #f2b45a;
    --warning-soft: rgb(242 180 90 / 0.14);
    --danger: #ff8a7f;
    --danger-soft: rgb(255 138 127 / 0.14);
    --info: #8eb4ff;
    --info-soft: rgb(142 180 255 / 0.14);
    --neutral: #9dafa4;
    --neutral-soft: rgb(247 244 234 / 0.06);
    --shadow-e1: 0 0 0 1px rgb(247 244 234 / 0.04);
    --highlight: inset 0 1px 0 rgb(255 255 255 / 0.06);
    color-scheme: dark;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 400 16px/1.5 var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, p, ul { margin: 0; }
ul { padding: 0; list-style: none; }
a { color: inherit; text-underline-offset: 3px; }
a:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; border-radius: 4px; }
.muted { color: var(--ink-muted); }
.wrap {
  max-width: 760px;
  margin: 0 auto;
  padding: max(16px, env(safe-area-inset-top)) max(var(--gutter), env(safe-area-inset-right))
    max(40px, env(safe-area-inset-bottom)) max(var(--gutter), env(safe-area-inset-left));
}

.top { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; }
.logo {
  display: inline-flex; align-items: center; gap: 7px;
  font: 700 24px/1 var(--font-display); letter-spacing: -0.035em; text-decoration: none;
}
.logo svg { width: 25px; height: 25px; fill: none; stroke: currentColor; stroke-width: 17; stroke-linecap: round; stroke-linejoin: round; }
.link { font-weight: 600; font-size: 15px; min-height: 44px; display: inline-flex; align-items: center; }

.icon { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 16; stroke-linecap: round; stroke-linejoin: round; }

.summary { display: flex; align-items: center; gap: 16px; padding: 40px 0 32px; }
.badge {
  display: grid; place-items: center; flex: none;
  width: 56px; height: 56px; border-radius: 50%;
  background: var(--tone-soft); color: var(--tone);
}
.badge .icon { width: 30px; height: 30px; stroke-width: 15; }
.summary h1 {
  font: 700 clamp(28px, 7vw, 40px)/1.1 var(--font-display);
  letter-spacing: -0.03em; text-wrap: balance;
}
.summary p { margin-top: 6px; }

.success { --tone: var(--success); --tone-soft: var(--success-soft); }
.warning { --tone: var(--warning); --tone-soft: var(--warning-soft); }
.danger { --tone: var(--danger); --tone-soft: var(--danger-soft); }
.info { --tone: var(--info); --tone-soft: var(--info-soft); }
.neutral { --tone: var(--neutral); --tone-soft: var(--neutral-soft); }

.notice {
  display: flex; gap: 12px; align-items: flex-start;
  padding: 16px 20px; margin-bottom: 12px;
  border-radius: var(--radius-md); background: var(--tone-soft);
}
.notice[hidden] { display: none; }
.notice > .icon { color: var(--tone); margin-top: 2px; }
.notice h2 { font-size: 17px; font-weight: 700; line-height: 1.35; }
.notice .meta { font-size: 14px; font-weight: 600; color: var(--tone); margin: 2px 0 6px; }
.notice.stale { margin-bottom: 24px; }

.section-title {
  font: 700 20px/1.2 var(--font-display); letter-spacing: -0.02em;
  margin: 36px 0 12px;
}
.components, .history {
  background: var(--surface); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-e1), var(--highlight);
}
.component { padding: 20px; }
.component + .component, .history li + li { border-top: 1px solid var(--line); }
.row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.component h3, .history h3 { font-size: 17px; font-weight: 700; line-height: 1.35; }
.component .muted { font-size: 15px; }
.state {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  font-weight: 700; font-size: 15px; color: var(--tone); text-align: right;
  max-width: 50%;
}
.state .icon { width: 16px; height: 16px; stroke-width: 18; }

.bars { display: flex; gap: 2px; height: 32px; margin-top: 16px; }
.bar { flex: 1; min-width: 0; border-radius: 2px; background: var(--tone); }
.bar.none { background: var(--line); }
.scale {
  display: flex; justify-content: space-between; gap: 8px;
  margin-top: 8px; font-size: 13px; color: var(--ink-muted);
}
.scale .narrow { display: none; }
@media (max-width: 560px) {
  .bars { gap: 1.5px; }
  .bar:nth-child(-n + ${DAYS / 2}) { display: none; }
  .scale .wide { display: none; }
  .scale .narrow { display: inline; }
}

.history li { padding: 16px 20px; }
.history .meta { font-size: 14px; color: var(--ink-muted); margin-top: 2px; }
.history .muted { margin-top: 6px; font-size: 15px; }
.quiet { padding: 4px 0; }

.foot { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--line); font-size: 15px; display: grid; gap: 8px; }
.foot a { font-weight: 600; }
`;
