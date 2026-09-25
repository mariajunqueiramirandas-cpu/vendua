import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, MessageCircle, NotebookPen } from 'lucide-react';
import type { LeadListItem } from '@/lib/api.ts';
import { AGENT_MODE_LABEL } from '@/lib/labels.ts';
import { ScoreBar } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { useOpenChannel } from './queries.ts';
import { NoteComposer } from './LeadTimeline.tsx';
import { StageProgress } from './Stepper.tsx';

/** Compact always-visible lead context above the tabs on phones/tablets. */
export function LeadSummaryBar({ lead }: { lead: LeadListItem }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b bg-card px-3 py-1.5">
      <div className="min-w-0 flex-1">
        {lead.businessName && (
          <p className="truncate text-xs text-muted-foreground">{lead.businessName}</p>
        )}
        <StageProgress state={lead.state} />
      </div>
      {lead.agentMode !== 'off' && (
        <Badge variant={lead.agentPausedAt ? 'warn' : 'agent-soft'}>
          agente {lead.agentPausedAt ? 'pausado' : AGENT_MODE_LABEL[lead.agentMode]}
        </Badge>
      )}
      <ScoreBar score={lead.score} />
    </div>
  );
}

/** Bottom quick actions (phones/tablets): jump into a channel thread or jot a note. */
export function LeadActionBar({ lead }: { lead: LeadListItem }) {
  const nav = useNavigate();
  const open = useOpenChannel(lead.id);
  const [noteOpen, setNoteOpen] = useState(false);
  const go = (ch: 'whatsapp' | 'email') =>
    open.mutate(ch, { onSuccess: (threadId) => nav(`/inbox/${threadId}`) });
  const busy = (ch: string) => open.isPending && open.variables === ch;

  return (
    <>
      <div className="grid shrink-0 grid-cols-3 gap-2 border-t bg-card px-3 py-2">
        <Button
          variant="outline"
          className="h-11 pointer-coarse:h-11"
          disabled={open.isPending}
          onClick={() => go('whatsapp')}
        >
          <MessageCircle /> {busy('whatsapp') ? 'abrindo…' : 'whatsapp'}
        </Button>
        <Button
          variant="outline"
          className="h-11 pointer-coarse:h-11"
          disabled={open.isPending}
          onClick={() => go('email')}
        >
          <Mail /> {busy('email') ? 'abrindo…' : 'email'}
        </Button>
        <Button className="h-11 pointer-coarse:h-11" onClick={() => setNoteOpen(true)}>
          <NotebookPen /> nota
        </Button>
      </div>
      <ResponsiveSheet
        open={noteOpen}
        onOpenChange={setNoteOpen}
        title="nova nota"
        description={lead.name}
      >
        <NoteComposer leadId={lead.id} autoFocus onSaved={() => setNoteOpen(false)} />
      </ResponsiveSheet>
    </>
  );
}
