import { ExternalLink } from 'lucide-react';
import type { SiteTaskEvent } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, rel } from '@/lib/format.ts';
import { Panel } from '@/components/ui/card.tsx';
import { MAX_FIX_PUSHES } from './bits.tsx';

type Tone = 'ok' | 'bad' | 'warn' | 'agent' | 'plain';

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sha = (v: unknown) => s(v)?.slice(0, 7) ?? null;
const join = (...xs: (string | null | false | undefined)[]) =>
  xs.filter(Boolean).join(' · ') || null;

const SOURCE: Record<string, string> = {
  owner: 'pedido pelo lojista',
  copilot: 'pedido pelo Duá',
  staff: 'pedido pela equipe',
};
const FROM: Record<string, string> = {
  escalated: 'estava travada',
  cancelled: 'estava cancelada',
  running: 'estava parada',
};

/** One timeline line in pt-BR: what happened, a detail line, a link, a tone. */
function describe(e: SiteTaskEvent): {
  title: string;
  detail: string | null;
  link: { href: string; label: string } | null;
  tone: Tone;
} {
  const d = e.detail ?? {};
  const base = { detail: null, link: null };
  switch (e.kind) {
    case 'queued':
      return {
        title: d.kind === 'revision' ? 'ajuste entrou na fila' : 'site entrou na fila',
        detail: SOURCE[s(d.source) ?? ''] ?? null,
        link: null,
        tone: 'plain',
      };
    case 'parked':
      return { ...base, title: 'routine não configurada — esperando', tone: 'warn' };
    case 'firing':
      return { ...base, title: 'disparando a routine', tone: 'agent' };
    case 'fired': {
      const url = s(d.sessionUrl);
      return {
        title: 'sessão do Claude começou',
        detail: null,
        link: url ? { href: url, label: 'abrir sessão' } : null,
        tone: 'agent',
      };
    }
    case 'pr_opened': {
      const url = s(d.url);
      return {
        title: n(d.number) ? `PR #${n(d.number)} aberto` : 'PR aberto',
        detail: null,
        link: url ? { href: url, label: 'ver PR' } : null,
        tone: 'agent',
      };
    }
    case 'pushed':
      return { title: 'novo push no PR', detail: sha(d.sha), link: null, tone: 'agent' };
    case 'ci_success':
      return { title: 'CI verde', detail: sha(d.sha), link: null, tone: 'ok' };
    case 'ci_failure':
      return {
        title: 'CI vermelho',
        detail: join(
          n(d.iterations) !== null && `correção ${n(d.iterations)}/${MAX_FIX_PUSHES}`,
          s(d.conclusion) === 'timed_out' && 'tempo esgotado',
          sha(d.sha),
        ),
        link: null,
        tone: 'bad',
      };
    case 'approved':
      return { ...base, title: `aprovado por ${s(d.by) ?? 'equipe'}`, tone: 'ok' };
    case 'merge_gate':
      return { title: 'merge barrado', detail: s(d.reason), link: null, tone: 'warn' };
    case 'merge_refused':
      return { title: 'o GitHub recusou o merge', detail: s(d.error), link: null, tone: 'bad' };
    case 'merged':
      return {
        title: 'PR mesclado',
        detail: join(d.by === 'github' && 'pelo GitHub', sha(d.sha)),
        link: null,
        tone: 'ok',
      };
    case 'design_read':
      return {
        title: 'design lido do PR',
        detail: n(d.pages) !== null ? `${n(d.pages)} páginas` : null,
        link: null,
        tone: 'plain',
      };
    case 'design_applied':
      return {
        title: 'design aplicado na loja',
        detail: join(
          n(d.pages) !== null && `${n(d.pages)} páginas`,
          d.tokens === true && 'cores e fontes',
        ),
        link: null,
        tone: 'ok',
      };
    case 'delivered':
      return { ...base, title: 'site no ar', tone: 'ok' };
    case 'escalated':
      return { title: 'travou', detail: s(d.reason), link: null, tone: 'bad' };
    case 'retried':
      return {
        title: n(d.attempt) ? `nova tentativa (${n(d.attempt)}ª)` : 'nova tentativa',
        detail: join(FROM[s(d.from) ?? ''], s(d.branch)),
        link: null,
        tone: 'plain',
      };
    case 'human':
      return { title: 'a equipe assumiu', detail: s(d.branch), link: null, tone: 'plain' };
    case 'cancelled':
      return { title: 'cancelado', detail: s(d.reason), link: null, tone: 'plain' };
    case 'due_soon':
      return { ...base, title: 'faltam menos de 8 h para o prazo', tone: 'warn' };
    case 'overdue':
      return { ...base, title: 'o prazo de 1 dia passou', tone: 'bad' };
    default:
      return { ...base, title: e.kind, tone: 'plain' };
  }
}

const DOT: Record<Tone, string> = {
  ok: 'bg-success',
  bad: 'bg-destructive',
  warn: 'bg-warning',
  agent: 'bg-agent',
  plain: 'bg-muted-foreground/50',
};

/** The task's own log (site_task_events), newest first. */
export function TaskTimeline({ events }: { events: SiteTaskEvent[] }) {
  const rows = [...events].reverse();
  return (
    <Panel title="andamento" aside={`${events.length} eventos`} flush>
      {!rows.length ? (
        <p className="p-3 text-sm text-muted-foreground">nada registrado ainda</p>
      ) : (
        <ol className="flex flex-col py-1">
          {rows.map((e, i) => {
            const x = describe(e);
            return (
              <li key={`${e.at}-${i}`} className="relative flex gap-2.5 px-3 py-1.5">
                {/* the rail between dots */}
                {i < rows.length - 1 && (
                  <span className="absolute top-4 bottom-[-6px] left-[15.5px] w-px bg-border-strong" />
                )}
                <span className={cn('relative mt-1.5 size-2 shrink-0 rounded-full', DOT[x.tone])} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm">{x.title}</span>
                  {x.detail && (
                    <span className="text-xs break-words text-muted-foreground">{x.detail}</span>
                  )}
                  {x.link && (
                    <a
                      href={x.link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-fit items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
                    >
                      {x.link.label}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <span
                  className="shrink-0 pt-0.5 text-xs text-muted-foreground tnum"
                  title={fmtDateTime(e.at)}
                >
                  {rel(e.at)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
