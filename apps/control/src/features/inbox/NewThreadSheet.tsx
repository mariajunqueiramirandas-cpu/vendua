import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { useDebounced } from '@/lib/hooks.ts';
import { qk } from '@/lib/query.ts';
import { Avatar, EmptyState, LoadingRows, StateChip } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { CH_ICON, CH_LABEL, CH_PICK } from './channel.ts';
import { useNewThread } from './queries.ts';

/** Start a conversation with any lead: search, then pick the channel. */
export function NewThreadSheet({
  open,
  onOpenChange,
  qs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** current inbox filters, carried into the new thread's URL */
  qs: string;
}) {
  const [leadQ, setLeadQ] = useState('');
  const dq = useDebounced(leadQ.trim(), 250);
  const nav = useNavigate();
  const params: Record<string, string> = dq ? { q: dq } : {};
  const hits = useQuery({
    queryKey: qk.leads(params),
    queryFn: () => api.leads(params),
    enabled: open,
    placeholderData: (prev) => prev,
  });
  const create = useNewThread();

  const openThread = (leadId: string, channel: string) =>
    create.mutate(
      { leadId, channel },
      {
        onSuccess: (r) => {
          onOpenChange(false);
          setLeadQ('');
          nav(`/inbox/${r.thread.id}${qs}`);
        },
      },
    );

  const leads = hits.data?.leads ?? [];
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="nova conversa"
      description="escolha o lead e o canal"
    >
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={leadQ}
            onChange={(e) => setLeadQ(e.target.value)}
            placeholder="buscar lead por nome, negócio ou contato…"
            aria-label="buscar lead"
            className="pl-8"
            autoFocus
          />
        </div>
        {hits.isPending ? (
          <LoadingRows rows={4} />
        ) : !leads.length ? (
          <EmptyState title={dq ? 'nenhum lead com esse nome' : 'digite para buscar'} />
        ) : (
          <ul className="-mx-1 flex flex-col divide-y">
            {leads.map((l) => (
              <li key={l.id} className="flex flex-col gap-1.5 px-1 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar name={l.name} size="sm" />
                  <span className="min-w-0 truncate font-medium">{l.name}</span>
                  {l.businessName && l.businessName !== l.name && (
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {l.businessName}
                    </span>
                  )}
                  <StateChip state={l.state} className="ml-auto" />
                </div>
                <div className="flex flex-wrap gap-1.5 pl-8">
                  {CH_PICK.map(({ ch, has }) => {
                    const Icon = CH_ICON[ch]!;
                    const ok = has(l);
                    const unverified = ch === 'whatsapp' && ok && !l.whatsappVerified;
                    return (
                      <Button
                        key={ch}
                        size="sm"
                        variant="outline"
                        disabled={!ok || create.isPending}
                        onClick={() => openThread(l.id, ch)}
                        title={
                          ok
                            ? unverified
                              ? 'whatsapp derivado do telefone — não verificado'
                              : `conversar via ${ch}`
                            : `lead sem ${ch}`
                        }
                      >
                        <Icon /> {CH_LABEL[ch]}
                        {unverified && <span className="text-warning-foreground">?</span>}
                      </Button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ResponsiveSheet>
  );
}
