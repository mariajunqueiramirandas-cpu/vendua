import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Ban, MoreVertical, PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, type LeadListItem } from '@/lib/api.ts';
import { errorMessage } from '@/lib/query.ts';
import { ScoreBar, StateChip } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/overlay.tsx';
import { invalidateLead } from './queries.ts';

type Armed = 'unsub' | 'archive' | null;

/** Header actions: stage/score at a glance + overflow with two-tap destructive items. */
export function LeadActions({ lead }: { lead: LeadListItem }) {
  const nav = useNavigate();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<Armed>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 2600);
    return () => clearTimeout(t);
  }, [armed]);

  const unsub = useMutation({
    mutationFn: () => api.unsubscribe(lead.id),
    onSuccess: () => toast.success('lead descadastrado'),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => invalidateLead(client, lead.id),
  });
  const archive = useMutation({
    mutationFn: () => api.deleteLead(lead.id),
    onSuccess: () => {
      toast.success('lead arquivado');
      void client.invalidateQueries({ queryKey: ['leads'] });
      void client.invalidateQueries({ queryKey: ['stats'] });
      nav('/pipeline');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // first select arms (menu stays open), second select fires
  const twoTap = (which: Exclude<Armed, null>, fire: () => void) => (e: Event) => {
    if (armed !== which) {
      e.preventDefault();
      setArmed(which);
      return;
    }
    setArmed(null);
    fire();
  };

  return (
    <>
      <span className="hidden items-center gap-2 lg:inline-flex">
        {lead.agentPausedAt && (
          <Badge variant="warn">
            <PauseCircle /> agente pausado
          </Badge>
        )}
        <StateChip state={lead.state} />
        <ScoreBar score={lead.score} />
      </span>
      {lead.unsubscribedAt && (
        <Badge variant="warn" title="descadastrado — o agente não fala mais com este lead">
          <Ban /> <span className="max-sm:hidden">descadastrado</span>
        </Badge>
      )}
      <DropdownMenu
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setArmed(null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="mais ações do lead">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {!lead.unsubscribedAt && (
            <DropdownMenuItem
              destructive={armed === 'unsub'}
              disabled={unsub.isPending}
              onSelect={twoTap('unsub', () => unsub.mutate())}
            >
              <Ban /> {armed === 'unsub' ? 'confirmar descadastro?' : 'descadastrar'}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            destructive
            disabled={archive.isPending}
            onSelect={twoTap('archive', () => archive.mutate())}
            className={armed === 'archive' ? 'bg-destructive-soft font-medium' : undefined}
          >
            <Archive /> {armed === 'archive' ? 'arquivar mesmo?' : 'arquivar'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
