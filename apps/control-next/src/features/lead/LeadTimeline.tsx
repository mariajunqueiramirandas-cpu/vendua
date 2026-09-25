import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SendHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Activity } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime } from '@/lib/format.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/input.tsx';
import { useActivities } from './queries.ts';

const KIND_LABEL: Record<string, string> = {
  note: 'nota',
  call: 'liga',
  meeting: 'reunião',
  meeting_booked: 'call marcada',
  meeting_done: 'call feita',
  meeting_no_show: 'no-show',
  meeting_cancelled: 'call cancelada',
  state_change: 'estágio',
  agent: 'agente',
  system: 'sistema',
  blocked: 'envio bloqueado',
};

// groups map kinds to the staff question ("o que o agente fez?", "quando mudou de estágio?")
const ACT_GROUPS: [string, (a: Activity) => boolean][] = [
  ['tudo', () => true],
  ['notas', (a) => a.kind === 'note'],
  ['calls', (a) => a.kind === 'call' || a.kind.startsWith('meeting')],
  ['estágio', (a) => a.kind === 'state_change'],
  ['agente', (a) => a.kind === 'agent' || a.createdBy === 'agent'],
  ['sistema', (a) => a.kind === 'system' || a.kind === 'blocked'],
];

export function useAddNote(leadId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.addActivity(leadId, 'note', body),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.activities(leadId) });
      void client.invalidateQueries({ queryKey: qk.lead(leadId) });
    },
  });
}

/** Note input: Enter saves, Shift+Enter breaks the line. */
export function NoteComposer({
  leadId,
  autoFocus,
  onSaved,
  className,
}: {
  leadId: string;
  autoFocus?: boolean | undefined;
  onSaved?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const [note, setNote] = useState('');
  const add = useAddNote(leadId);
  const submit = () => {
    const body = note.trim();
    if (!body || add.isPending) return;
    add.mutate(body, {
      onSuccess: () => {
        setNote('');
        onSaved?.();
      },
    });
  };
  return (
    <div className={cn('flex items-end gap-1.5', className)}>
      <Textarea
        autoFocus={autoFocus}
        rows={1}
        value={note}
        placeholder="anotar…"
        aria-label="nova nota"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className="max-h-40 min-h-10 field-sizing-content resize-none py-2 md:min-h-8 md:py-1.5"
      />
      <Button
        size="icon"
        onClick={submit}
        disabled={!note.trim() || add.isPending}
        aria-label="salvar nota"
        title="salvar nota"
      >
        <SendHorizontal />
      </Button>
    </div>
  );
}

function dotClass(a: Activity) {
  if (a.createdBy === 'agent' || a.kind === 'agent') return 'bg-agent ring-agent/30';
  if (a.kind === 'state_change') return 'bg-primary dark:bg-foreground';
  if (a.kind === 'blocked') return 'bg-destructive';
  if (a.kind === 'note') return 'bg-warning';
  return 'bg-border-strong';
}

export function LeadTimeline({ leadId, composer = true }: { leadId: string; composer?: boolean }) {
  const { data: acts = [], isPending, error, refetch } = useActivities(leadId);
  const [group, setGroup] = useState('tudo');
  const filtered = acts.filter(ACT_GROUPS.find(([g]) => g === group)?.[1] ?? (() => true));
  const groups = ACT_GROUPS.filter(([g, f]) => g === 'tudo' || acts.some((a) => f(a)));

  return (
    <div className="flex flex-col gap-3">
      {composer && <NoteComposer leadId={leadId} />}
      {acts.length > 0 && groups.length > 2 && (
        <div className="no-scrollbar -mx-3 flex gap-1 overflow-x-auto px-3 md:mx-0 md:px-0">
          {groups.map(([g]) => (
            <button
              key={g}
              type="button"
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
              className="h-6 shrink-0 rounded-full border px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground pointer-coarse:h-8"
            >
              {g}
            </button>
          ))}
        </div>
      )}
      {isPending ? (
        <LoadingRows rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !acts.length ? (
        <EmptyState title="sem atividade" hint="notas, ligações e ações do agente aparecem aqui" />
      ) : !filtered.length ? (
        <EmptyState title="nada neste grupo" hint="troque o filtro acima" />
      ) : (
        <ol className="relative">
          {filtered.map((a, i) => (
            <li key={a.id} className="relative flex gap-2.5 pb-3 last:pb-0">
              {i < filtered.length - 1 && (
                <span
                  aria-hidden
                  className="absolute top-3 bottom-0 left-[3.5px] w-px bg-border-strong"
                />
              )}
              <span
                aria-hidden
                className={cn('relative mt-1.5 size-2 shrink-0 rounded-full', dotClass(a))}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      'font-medium',
                      (a.createdBy === 'agent' || a.kind === 'agent') && 'text-foreground',
                    )}
                  >
                    {a.createdBy === 'agent' ? 'agente' : (KIND_LABEL[a.kind] ?? a.kind)}
                  </span>
                  <span>·</span>
                  <time className="tnum" dateTime={a.at}>
                    {fmtDateTime(a.at)}
                  </time>
                </div>
                {a.body && <p className="text-sm break-words whitespace-pre-wrap">{a.body}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
