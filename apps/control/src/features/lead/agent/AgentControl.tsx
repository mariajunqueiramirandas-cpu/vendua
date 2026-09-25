import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, PauseCircle, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, type AutonomyLevel, type LeadListItem } from '@/lib/api.ts';
import { AGENT_GOALS, AGENT_MODES } from '@/lib/labels.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Segmented, Switch } from '@/components/ui/controls.tsx';
import { Select } from '@/components/ui/input.tsx';
import { useLeadAutonomy, useLeadThreads, type LeadPatch } from '../queries.ts';
import { Hint, Row, Section } from '../Section.tsx';
import { FetchErr, isMissing } from './shared.tsx';

const LEVEL_LABEL: Record<AutonomyLevel, string> = {
  off: 'off',
  copilot: 'copiloto',
  supervised: 'supervisionado',
  autopilot: 'piloto automático',
};
const LEVEL_NOTE: Record<AutonomyLevel, string> = {
  off: 'o agente só age quando alguém dispara um run',
  copilot: 'roda sozinho, mas toda mensagem vira rascunho',
  supervised: 'primeiro contato passa por aprovação; follow-ups e respostas saem',
  autopilot: 'envia sem aprovação — horário, teto diário e demais limites valem',
};
const SEND_LABEL = {
  auto: 'envia sem aprovação',
  draft: 'vira rascunho',
  blocked: 'envio bloqueado',
} as const;
const SEND_VARIANT = { auto: 'agent', draft: 'warn', blocked: 'bad' } as const;

const MODE_NOTE: Record<string, string> = {
  off: 'a equipe toca o lead — o agente não tria nem fala com ele',
  draft: 'o agente prepara mensagens — você aprova cada envio no inbox',
  auto: 'o agente conversa sozinho, dentro das guardrails',
};

type ActChannel = 'auto' | 'whatsapp' | 'email';

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

function AutonomySummary({ leadId }: { leadId: string }) {
  const { data, isPending, error, refetch } = useLeadAutonomy(leadId);
  if (isPending) return <Hint>carregando…</Hint>;
  if (error && isMissing(error))
    return (
      <Hint>
        a API ainda não expõe a explicação de autonomia — os controles abaixo valem normalmente
      </Hint>
    );
  if (error) return <FetchErr what="a autonomia" retry={() => void refetch()} />;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm">
        {data.reasons[0]?.message ??
          (data.canRun ? 'o agente pode agir neste lead' : 'o agente não age neste lead')}
      </p>
      {data.reasons.slice(1).map((r) => (
        <p key={r.code} className="text-xs text-muted-foreground">
          · {r.message}
        </p>
      ))}
    </div>
  );
}

export function AutonomyBadges({ leadId }: { leadId: string }) {
  const { data } = useLeadAutonomy(leadId);
  if (!data) return null;
  return (
    <>
      <Badge variant="agent" title={LEVEL_NOTE[data.level]}>
        {LEVEL_LABEL[data.level]}
      </Badge>
      <Badge variant={SEND_VARIANT[data.sendMode]}>{SEND_LABEL[data.sendMode]}</Badge>
    </>
  );
}

/** Mode/goal/pause, per-thread switches and the manual "agir agora" trigger. */
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

  return (
    <Section title="agente" actions={<AutonomyBadges leadId={lead.id} />}>
      <AutonomySummary leadId={lead.id} />

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

      {lead.agentPausedAt ? (
        <Row className="mt-2 rounded-md bg-warning-soft px-2">
          <Badge variant="warn">
            <PauseCircle /> pausado
          </Badge>
          <span className="min-w-0 flex-1 text-xs text-warning-foreground">
            handoff da equipe — o agente segura este lead
          </span>
          <Button
            size="sm"
            variant="outline"
            title="retomar libera o agente neste lead de novo"
            onClick={() => patch({ agentPaused: false })}
          >
            <PlayCircle /> retomar
          </Button>
        </Row>
      ) : (
        lead.agentMode !== 'off' && (
          <Row className="mt-1">
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              handoff — pausar o agente e assumir a conversa
            </span>
            <Button
              size="sm"
              variant="ghost"
              title="o agente para de agir neste lead até alguém retomar"
              onClick={() => patch({ agentPaused: true })}
            >
              <PauseCircle /> pausar
            </Button>
          </Row>
        )
      )}

      {threads.length > 0 && (
        <div className="mt-1 border-t pt-1">
          {threads.map((t) => (
            <Row key={t.id}>
              <Badge>{t.channel}</Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {t.agentEnabled ? 'agente lê e responde' : 'agente não entra nesta conversa'}
              </span>
              <ThreadAgentSwitch thread={t} leadId={lead.id} />
            </Row>
          ))}
        </div>
      )}

      {lead.agentMode !== 'off' && !lead.unsubscribedAt && !lead.agentPausedAt && (
        <div className="mt-2 flex flex-col gap-1">
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
              <option value="email">canal: email</option>
            </Select>
            <Button
              variant="agent"
              title="rodar o agente agora"
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
