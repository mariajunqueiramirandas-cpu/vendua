import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, PauseCircle, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, type LeadListItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { AGENT_GOALS, AGENT_MODES, AUTONOMY_LABEL } from '@/lib/labels.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Segmented, Switch } from '@/components/ui/controls.tsx';
import { Select } from '@/components/ui/input.tsx';
import { useLeadAutonomy, useLeadThreads, type LeadPatch } from '../queries.ts';
import { Hint, Row, Section } from '../Section.tsx';
import { FetchErr, isMissing } from './shared.tsx';

const SEND_LABEL = {
  auto: 'envia direto',
  draft: 'vira rascunho',
  blocked: 'bloqueado',
} as const;
const SEND_VARIANT = { auto: 'agent', draft: 'warn', blocked: 'bad' } as const;

const MODE_NOTE: Record<string, string> = {
  off: 'a equipe toca o lead — o agente não responde nem faz follow-up',
  draft: 'o agente prepara mensagens — você aprova cada envio no inbox',
  auto: 'o agente age dentro da autonomia e dos limites configurados',
};

type ActChannel = 'auto' | 'whatsapp' | 'instagram' | 'email';

/** Per-thread agent on/off, optimistic on the lead's thread list. */
export function ThreadAgentSwitch({
  thread,
  leadId,
}: {
  thread: { id: string; channel: string; agentEnabled: boolean };
  leadId: string;
}) {
  const client = useQueryClient();
  const key = qk.leadThreads(leadId);
  type T = { threads: { id: string; channel: string; agentEnabled: boolean }[] };
  const m = useMutation({
    mutationFn: (enabled: boolean) => api.setThreadAgent(thread.id, enabled),
    onMutate: async (enabled) => {
      await client.cancelQueries({ queryKey: key });
      const prev = client.getQueryData<T>(key);
      if (prev)
        client.setQueryData<T>(key, {
          ...prev,
          threads: prev.threads.map((t) =>
            t.id === thread.id ? { ...t, agentEnabled: enabled } : t,
          ),
        });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) client.setQueryData(key, ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: qk.thread(thread.id) });
      void client.invalidateQueries({ queryKey: ['threads'] });
      void client.invalidateQueries({ queryKey: qk.leadAutonomy(leadId) });
    },
  });
  return (
    <label className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Switch
        checked={thread.agentEnabled}
        onCheckedChange={(v) => m.mutate(v)}
        aria-label={`agente na conversa ${thread.channel}`}
      />
      agente
    </label>
  );
}

function AutonomyVerdict({ lead, onResume }: { lead: LeadListItem; onResume: () => void }) {
  const { data, isPending, error, refetch } = useLeadAutonomy(lead.id);

  if (lead.agentPausedAt) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-2">
        <PauseCircle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-warning-foreground">pausado · handoff da equipe</p>
          <p className="text-xs text-muted-foreground">
            o agente segura este lead até alguém retomar
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onResume}>
          <PlayCircle /> retomar
        </Button>
      </div>
    );
  }

  if (isPending) return <Hint>verificando autonomia…</Hint>;
  if (error && isMissing(error))
    return (
      <Hint>explicação de autonomia indisponível — os controles abaixo valem normalmente</Hint>
    );
  if (error) return <FetchErr what="a autonomia" retry={() => void refetch()} />;

  const tone =
    data.sendMode === 'auto'
      ? 'border-agent/35 bg-agent-soft/60'
      : data.sendMode === 'draft'
        ? 'border-warning/30 bg-warning-soft/70'
        : 'border-border bg-muted/60';

  return (
    <div className={cn('flex flex-col gap-1 rounded-md border px-2.5 py-2', tone)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={SEND_VARIANT[data.sendMode]}>{SEND_LABEL[data.sendMode]}</Badge>
        <span className="text-[11px] text-muted-foreground">
          workspace: {AUTONOMY_LABEL[data.level]}
        </span>
      </div>
      <p className="text-xs text-foreground">
        {data.reasons[0]?.message ??
          (data.canRun ? 'o agente pode agir neste lead' : 'o agente não age neste lead')}
      </p>
      {data.reasons.slice(1).map((r) => (
        <p key={r.code} className="text-[11px] text-muted-foreground">
          · {r.message}
        </p>
      ))}
    </div>
  );
}

/** Mode/goal/pause, muted-thread alerts and manual "agir agora" trigger. */
export function AgentControl({
  lead,
  patch,
}: {
  lead: LeadListItem;
  patch: (p: LeadPatch) => void;
}) {
  const client = useQueryClient();
  const { data: threads = [] } = useLeadThreads(lead.id);
  const [channel, setChannel] = useState<ActChannel>('auto');
  const [actErr, setActErr] = useState('');
  const run = useMutation({
    mutationFn: () => api.requestAgent({ kind: 'outreach', leadIds: [lead.id], channel }),
    onSuccess: () => {
      setActErr('');
      toast.success('agente disparado');
    },
    onError: (e) => setActErr(e instanceof ApiError ? e.message : 'falha ao disparar'),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['runs'] });
      void client.invalidateQueries({ queryKey: qk.lead(lead.id) });
    },
  });

  // Only surface thread exceptions here — full per-thread controls live in Conversas & Inbox.
  const mutedThreads = threads.filter((t) => !t.agentEnabled);

  return (
    <Section
      title="controle do agente"
      actions={
        !lead.agentPausedAt &&
        lead.agentMode !== 'off' && (
          <Button
            size="sm"
            variant="ghost"
            title="pausar o agente neste lead para a equipe assumir"
            onClick={() => patch({ agentPaused: true })}
          >
            <PauseCircle /> pausar
          </Button>
        )
      }
    >
      <AutonomyVerdict lead={lead} onResume={() => patch({ agentPaused: false })} />

      <div className="mt-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 text-xs text-muted-foreground">modo</span>
          <Segmented
            size="sm"
            value={lead.agentMode}
            onChange={(agentMode) => patch({ agentMode })}
            options={AGENT_MODES}
          />
        </div>
        {lead.agentMode !== 'off' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 text-xs text-muted-foreground">objetivo</span>
            <Segmented
              size="sm"
              value={lead.agentGoal}
              onChange={(agentGoal) => patch({ agentGoal })}
              options={AGENT_GOALS}
            />
          </div>
        )}
        <Hint>{MODE_NOTE[lead.agentMode]}</Hint>
      </div>

      {mutedThreads.length > 0 && (
        <div className="mt-2 border-t pt-2">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">
            conversas silenciadas
          </p>
          {mutedThreads.map((t) => (
            <Row key={t.id}>
              <Badge variant="outline">{t.channel}</Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                desligado nesta conversa
              </span>
              <ThreadAgentSwitch thread={t} leadId={lead.id} />
            </Row>
          ))}
        </div>
      )}

      {lead.agentMode !== 'off' && !lead.unsubscribedAt && !lead.agentPausedAt && (
        <div className="mt-2.5 flex flex-col gap-1 border-t pt-2.5">
          <div className="flex gap-1.5">
            <Select
              value={channel}
              onChange={(e) => setChannel(e.target.value as ActChannel)}
              title="canal do disparo — auto = o agente escolhe o canal alcançável"
              aria-label="canal do disparo"
              className="flex-1"
            >
              <option value="auto">canal: auto</option>
              <option value="whatsapp">canal: whatsapp</option>
              <option value="instagram">canal: instagram</option>
              <option value="email">canal: email</option>
            </Select>
            <Button
              variant="agent"
              title="disparar o agente agora neste lead"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              <Bot /> agir agora
            </Button>
          </div>
          {actErr && <p className="text-xs text-destructive-foreground">{actErr}</p>}
        </div>
      )}
    </Section>
  );
}
