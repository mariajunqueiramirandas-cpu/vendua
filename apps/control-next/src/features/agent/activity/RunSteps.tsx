import type { ReactNode } from 'react';
import {
  Bot,
  ChevronRight,
  FileText,
  Inbox,
  Lightbulb,
  Loader2,
  Megaphone,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { fmtUsd } from '@/lib/format.ts';
import { EmptyState } from '@/components/common.tsx';
import { callNames } from '../discovery/journal.ts';

export interface Step {
  type: string;
  name?: string;
  callId?: string;
  args?: unknown;
  out?: unknown;
  content?: unknown;
  /** journal holds {name,args,id} objects; older rows may hold bare names */
  toolCalls?: unknown[];
  pending?: boolean;
  usage?: { costUsd?: number | null; tokensIn?: number; tokensOut?: number };
}

// injected-content steps render with their own label instead of an anonymous `tool · #N`
const STEP_LABELS: Record<string, string> = {
  system_prompt: 'prompt',
  model: 'modelo',
  inbox: 'caixa de entrada',
  nudge: 'nudge',
  reflection: 'reflexão',
};
const CONTENT_STEPS = new Set(['inbox', 'nudge', 'reflection']);
const ICON: Record<string, typeof Bot> = {
  system_prompt: FileText,
  model: Bot,
  tool: Wrench,
  inbox: Inbox,
  nudge: Megaphone,
  reflection: Lightbulb,
};

const json = (v: unknown, max: number) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 1);
  return (s ?? '').slice(0, max);
};

const toolError = (out: unknown) =>
  out && typeof out === 'object' && 'error' in out && (out as { error: unknown }).error
    ? String((out as { error: unknown }).error)
    : null;

function Pre({ children, tone }: { children: ReactNode; tone?: 'bad' | undefined }) {
  return (
    <pre
      className={cn(
        'max-h-72 overflow-auto rounded-md bg-muted px-2.5 py-1.5 font-mono text-[12px] leading-snug break-words whitespace-pre-wrap',
        tone === 'bad' && 'bg-destructive-soft text-destructive-foreground',
      )}
    >
      {children}
    </pre>
  );
}

function Disclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}

function StepBody({ s }: { s: Step }) {
  if (s.type === 'system_prompt')
    return (
      <Disclosure summary="ver prompt">
        <Pre>{String(s.content).slice(0, 1500)}</Pre>
      </Disclosure>
    );
  if (s.type === 'model')
    return (
      <>
        {s.content != null && String(s.content).trim() && <Pre>{String(s.content)}</Pre>}
        {s.toolCalls?.length ? (
          <p className="font-mono text-xs text-muted-foreground">→ {callNames(s.toolCalls)}</p>
        ) : null}
      </>
    );
  if (s.type === 'tool') {
    if (s.pending)
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> executando…
        </p>
      );
    const err = toolError(s.out);
    return (
      <>
        {s.args != null && Object.keys(s.args as object).length > 0 && (
          <Disclosure summary="argumentos">
            <Pre>{json(s.args, 3000)}</Pre>
          </Disclosure>
        )}
        <Pre tone={err ? 'bad' : undefined}>{json(s.out, 3000)}</Pre>
      </>
    );
  }
  if (CONTENT_STEPS.has(s.type) && s.content != null) return <Pre>{String(s.content)}</Pre>;
  return null;
}

/** The run's journal as a vertical timeline: prompt, model turns, tool calls and their results. */
export function RunSteps({ steps }: { steps: Step[] }) {
  if (!steps.length) return <EmptyState title="sem passos ainda" className="py-6" />;
  return (
    <ol className="relative flex flex-col">
      {steps.map((s, i) => {
        const Icon = ICON[s.type] ?? Wrench;
        const err = s.type === 'tool' && !s.pending && toolError(s.out);
        const cost = s.usage?.costUsd;
        return (
          <li key={i} className="relative flex gap-2.5 pb-3 last:pb-0">
            {i < steps.length - 1 && (
              <span aria-hidden className="absolute top-6 bottom-0 left-[11px] w-px bg-border" />
            )}
            <span
              className={cn(
                'relative z-[1] mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground [&_svg]:size-3.5',
                s.type === 'model' && 'border-agent bg-agent-soft text-foreground',
                s.type === 'tool' && s.pending && 'border-agent',
                err && 'border-destructive/50 bg-destructive-soft text-destructive-foreground',
              )}
            >
              <Icon />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-h-6 items-center gap-2">
                <span className="text-[13px] font-medium">
                  {STEP_LABELS[s.type] ?? (
                    <>
                      <span className="text-muted-foreground">tool · </span>
                      <span className="font-mono text-[12px]">{s.name ?? s.callId ?? `#${i}`}</span>
                    </>
                  )}
                </span>
                {err && <span className="text-[11px] text-destructive-foreground">erro</span>}
                {s.type === 'model' && s.usage && (s.usage.tokensIn || s.usage.tokensOut) ? (
                  <span className="ml-auto text-[11px] text-muted-foreground tnum">
                    {s.usage.tokensIn ?? 0}↑ {s.usage.tokensOut ?? 0}↓
                    {cost ? ` · ${fmtUsd(cost)}` : ''}
                  </span>
                ) : null}
              </div>
              <StepBody s={s} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
