import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Ban, MoreVertical, PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, type LeadListItem } from '@/lib/api.ts';
import { errorMessage } from '@/lib/query.ts';
import { toastUndo } from '@/lib/undo.ts';
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

type Armed = 'unsub' | null;

/** Header actions: stage/score at a glance + overflow (descadastro is two-tap; archiving undoes). */
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
    mutationFn: (archived: boolean) => api.patchLead(lead.id, { archived }),
    onSuccess: (_r, archived) => {
      invalidateLead(client, lead.id);
      if (!archived) {
        toast.success('lead restaurado');
        return;
      }
      toastUndo('lead arquivado', async () => {
        await api.patchLead(lead.id, { archived: false });
        invalidateLead(client, lead.id);
      });
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
      {lead.archivedAt && (
        <Button
          size="sm"
          variant="outline"
          disabled={archive.isPending}
          onClick={() => archive.mutate(false)}
          title="arquivado — volta para o funil"
        >
          <ArchiveRestore /> restaurar
        </Button>
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
          {lead.archivedAt ? (
            <DropdownMenuItem disabled={archive.isPending} onSelect={() => archive.mutate(false)}>
              <ArchiveRestore /> restaurar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              destructive
              disabled={archive.isPending}
              onSelect={() => archive.mutate(true)}
            >
              <Archive /> arquivar
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
