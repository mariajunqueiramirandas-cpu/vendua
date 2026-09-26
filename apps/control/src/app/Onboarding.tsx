import { useEffect, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, ListChecks } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { qk } from '@/lib/query.ts';
import { useIntegrations } from '@/lib/queries.ts';
import { Button } from '@/components/ui/button.tsx';
import { Dialog } from '@/components/ui/overlay.tsx';
import { obj, str, useMeetingsStatus, useSettingsMap } from '@/features/settings/queries.ts';

/** workspace-wide, so a fresh install (new volumes) greets whoever logs in first */
const KEY = 'onboarding';

type Step = { key: string; label: string; hint: string; done: boolean; to: string };

/**
 * First-run setup checklist. Opens by itself once on a fresh install (no model yet); after
 * that a pill reopens it until every step is done or someone picks "não mostrar mais".
 * Opening a step only closes the dialog — the pill brings it back to see what's left.
 */
export function Onboarding() {
  const integQ = useIntegrations();
  const settingsQ = useSettingsMap();
  const mQ = useMeetingsStatus();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  // an open conversation owns the bottom edge (composer)
  const inThread = useMatch('/inbox/:threadId');

  const save = (value: Record<string, unknown>) =>
    void api
      .putSetting(KEY, value)
      .then(() => qc.invalidateQueries({ queryKey: qk.settings() }))
      .catch(() => {});

  const ready = Boolean(integQ.data && settingsQ.data);
  const on = (kind: string) =>
    integQ.data?.integrations.find((i) => i.kind === kind && i.enabled)?.driver;
  const state = obj(settingsQ.data?.[KEY]);
  const firstRun = ready && !state.seenAt && !on('llm');

  useEffect(() => {
    if (!firstRun) return;
    setOpen(true);
    save({ seenAt: new Date().toISOString() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the first run is known
  }, [firstRun]);

  if (!ready) return null;

  const llm = on('llm');
  const channel = on('whatsapp') ?? on('email') ?? on('instagram');
  const product = str(obj(settingsQ.data?.pitch).product, '');
  const weekDays = mQ.data
    ? Object.values(mQ.data.cfg.weekly).filter((w) => w.length > 0).length
    : 0;
  const steps: Step[] = [
    {
      key: 'llm',
      label: 'conecte o modelo',
      hint: llm ? `${llm} ativo` : 'sem ele o agente não roda — nem a revisão semanal',
      done: Boolean(llm),
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
      hint: product ? 'definida' : 'o que você vende e para quem',
      done: Boolean(product),
      to: '/agente/estudio',
    },
    {
      key: 'agenda',
      label: 'abra horários na agenda',
      hint: weekDays ? `${weekDays}d/semana abertos` : 'para o agente marcar calls',
      done: weekDays > 0,
      to: '/config?a=agenda',
    },
  ];
  const done = steps.filter((s) => s.done).length;
  const allDone = done === steps.length;
  // a workspace that never went through this (set up before it existed) grows no pill
  const pill = Boolean(state.seenAt) && !state.dismissedAt && !allDone && !open && !inThread;
  if (!pill && !open) return null;

  return (
    <>
      {pill && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-3 bottom-[calc(64px+env(safe-area-inset-bottom,0px))] z-40 inline-flex h-9 items-center gap-2 rounded-full border bg-card px-3.5 text-[13px] font-medium shadow-pop hover:bg-muted md:right-5 md:bottom-5 [&_svg]:size-4"
        >
          <ListChecks className="text-muted-foreground" />
          configuração
          <span className="text-muted-foreground tnum">
            {done} de {steps.length}
          </span>
        </button>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={allDone ? 'tudo pronto' : 'bem-vindo ao venduá'}
        description={`${done} de ${steps.length} passos — abra um passo e volte aqui pelo botão "configuração"`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                save({ ...state, dismissedAt: new Date().toISOString() });
              }}
            >
              não mostrar mais
            </Button>
            <Button onClick={() => setOpen(false)}>fechar</Button>
          </>
        }
      >
        <ol className="divide-y rounded-lg border">
          {steps.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  nav(s.to);
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-hover pointer-coarse:py-3"
              >
                <span
                  className={cn(
                    'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tnum [&_svg]:size-3.5',
                    s.done ? 'bg-agent text-agent-foreground' : 'bg-secondary text-foreground',
                  )}
                >
                  {s.done ? <Check /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-sm font-medium',
                      s.done && 'text-muted-foreground line-through',
                    )}
                  >
                    {s.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ol>
      </Dialog>
    </>
  );
}
