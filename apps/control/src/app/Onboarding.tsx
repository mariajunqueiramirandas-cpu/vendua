import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { qk } from '@/lib/query.ts';
import { useIntegrations } from '@/lib/queries.ts';
import { Button } from '@/components/ui/button.tsx';
import { Dialog } from '@/components/ui/overlay.tsx';
import { obj, str, useSettingsMap } from '@/features/settings/queries.ts';

/** workspace-wide, so a fresh install (new volumes) greets whoever logs in first */
const KEY = 'onboarding';

type Step = { key: string; label: string; hint: string; done: boolean; to: string };

/**
 * First-login welcome: what to wire up before the agent does anything real. Shows while the
 * workspace has no model and nobody dismissed it — until then no routine runs on its own.
 */
export function Onboarding() {
  const integQ = useIntegrations();
  const settingsQ = useSettingsMap();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [closed, setClosed] = useState(false);

  if (!integQ.data || !settingsQ.data) return null;
  const on = (kind: string) =>
    integQ.data.integrations.find((i) => i.kind === kind && i.enabled)?.driver;
  const llm = on('llm');
  if (closed || llm || settingsQ.data[KEY]) return null;

  const pitch = obj(settingsQ.data.pitch);
  const channel = on('whatsapp') ?? on('email') ?? on('instagram');
  const steps: Step[] = [
    {
      key: 'llm',
      label: 'conecte o modelo',
      hint: 'sem ele o agente não roda — nem a revisão semanal',
      done: false,
      to: '/config?a=conexoes&p=llm',
    },
    {
      key: 'canal',
      label: 'conecte um canal',
      hint: channel ? `${channel} ativo` : 'whatsapp, e-mail ou instagram para conversar',
      done: Boolean(channel),
      to: '/config?a=conexoes&p=whatsapp',
    },
    {
      key: 'voz',
      label: 'dê voz ao agente',
      hint: str(pitch.product, '') ? 'definida' : 'o que você vende e para quem',
      done: Boolean(str(pitch.product, '')),
      to: '/agente/estudio',
    },
    {
      key: 'agenda',
      label: 'abra horários na agenda',
      hint: 'para o agente marcar calls',
      done: false,
      to: '/config?a=agenda',
    },
  ];

  const dismiss = (to?: string) => {
    setClosed(true);
    void api
      .putSetting(KEY, { dismissedAt: new Date().toISOString() })
      .then(() => qc.invalidateQueries({ queryKey: qk.settings() }))
      .catch(() => {});
    if (to) nav(to);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && dismiss()}
      title="bem-vindo ao venduá"
      description="alguns passos antes do agente trabalhar de verdade — tudo fica em configurações depois"
      footer={
        <>
          <Button variant="ghost" onClick={() => dismiss()}>
            depois
          </Button>
          <Button onClick={() => dismiss('/config')}>abrir configurações</Button>
        </>
      }
    >
      <ol className="divide-y rounded-lg border">
        {steps.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => dismiss(s.to)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-hover pointer-coarse:py-3"
            >
              <span
                className={cn(
                  'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tnum',
                  s.done ? 'bg-agent text-agent-foreground' : 'bg-secondary text-foreground',
                )}
              >
                {s.done ? '✓' : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.hint}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
