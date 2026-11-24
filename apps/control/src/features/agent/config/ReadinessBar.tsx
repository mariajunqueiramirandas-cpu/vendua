import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { useIntegrations } from '@/lib/queries.ts';
import { qk } from '@/lib/query.ts';
import { Card } from '@/components/ui/card.tsx';
import { KINDS, providerStatus, WA_IDLE } from '@/features/settings/providers.ts';
import { useIgStatus, useMeetingsStatus, useWaQr } from '@/features/settings/queries.ts';

type Tone = 'live' | 'warn' | 'off';

const DOT: Record<Tone, string> = {
  live: 'bg-agent',
  warn: 'bg-warning',
  off: 'bg-border-strong',
};

/** Compact dependency strip linking Configurar to AI models, channels, and meetings. */
export function ReadinessBar() {
  const aiQ = useQuery({ queryKey: qk.aiModels(), queryFn: api.aiModels });
  const integQ = useIntegrations();
  const waQ = useWaQr();
  const igQ = useIgStatus();
  const mQ = useMeetingsStatus();

  const modelsReady =
    aiQ.isSuccess && (Boolean(aiQ.data.primaryRoute) || aiQ.data.routesSource !== 'none');
  const modelText = !aiQ.data
    ? 'lendo…'
    : aiQ.data.primaryRoute
      ? aiQ.data.primaryRoute.model
      : aiQ.data.routesSource !== 'none'
        ? 'rotas configuradas'
        : 'nenhum modelo configurado';
  const modelTone: Tone = !aiQ.data ? 'off' : modelsReady ? 'live' : 'warn';

  const integrations = integQ.data?.integrations ?? [];
  const wa = waQ.data ?? WA_IDLE;
  const ig = igQ.data ?? null;
  const sendKinds = KINDS.filter((k) => k.key !== 'discovery');
  const liveChannels = sendKinds
    .filter(
      (k) =>
        providerStatus(
          k.key,
          integrations.filter((i) => i.kind === k.key),
          k.key === 'whatsapp' ? wa : WA_IDLE,
          ig,
        ).tone === 'live',
    )
    .map((k) => k.label);
  const chanTone: Tone = integQ.isPending ? 'off' : liveChannels.length > 0 ? 'live' : 'warn';
  const chanText = integQ.isPending
    ? 'lendo…'
    : liveChannels.length > 0
      ? liveChannels.join(' · ')
      : 'nenhum canal pronto';

  const weekDays = mQ.data
    ? Object.values(mQ.data.cfg.weekly).filter((w) => w.length > 0).length
    : 0;
  const meetReady = Boolean(
    mQ.data && weekDays > 0 && (mQ.data.room.provider === 'daily' || mQ.data.cfg.roomUrl),
  );
  const meetTone: Tone = !mQ.data ? 'off' : meetReady ? 'live' : 'warn';
  const meetText = !mQ.data
    ? 'lendo…'
    : weekDays === 0
      ? 'sem horários abertos'
      : !meetReady
        ? `${weekDays}d/sem · sem link de sala`
        : `${weekDays}d/sem · ${mQ.data.room.provider === 'daily' ? 'daily.co' : 'sala fixa'}`;

  const items: { label: string; text: string; tone: Tone; to: string }[] = [
    { label: 'modelo de IA', text: modelText, tone: modelTone, to: '/ia/modelos' },
    { label: 'canais de envio', text: chanText, tone: chanTone, to: '/config?a=conexoes' },
    { label: 'reuniões', text: meetText, tone: meetTone, to: '/config?a=reunioes' },
  ];

  return (
    <Card className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {items.map((it) => (
        <Link
          key={it.label}
          to={it.to}
          className="group flex items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-hover"
        >
          <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[it.tone])} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-muted-foreground">{it.label}</div>
            <div
              className={cn(
                'truncate text-xs font-medium',
                it.tone === 'warn' && 'text-warning-foreground',
              )}
            >
              {it.text}
            </div>
          </div>
          <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
        </Link>
      ))}
    </Card>
  );
}
