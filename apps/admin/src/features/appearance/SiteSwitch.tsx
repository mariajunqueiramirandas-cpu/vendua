import {
  CaretDown,
  CheckCircle,
  Circle,
  Sparkle,
  SquaresFour,
  type Icon,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, type SiteMode } from '../../lib/api.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { messageOf } from '../../ui/feedback.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';

// A store with a site sob medida picks which site it shows (ADR 0040). Each keeps its own layout
// and colours, the owner's edits included, so the switch is a choice and never a loss.

const SITES: Record<SiteMode, { label: string; hint: string; Icon: Icon }> = {
  custom: {
    label: 'Site sob medida',
    hint: 'O site feito para a sua loja, com o layout e as cores dele.',
    Icon: Sparkle,
  },
  template: {
    label: 'Modelo padrão',
    hint: 'O site padrão da Venduá: capa, logo, horário, entrega e cardápio.',
    Icon: SquaresFour,
  },
};
const ORDER: SiteMode[] = ['custom', 'template'];

export function SiteSwitch({
  mode,
  dirty,
  onSwitched,
  className,
}: {
  mode: SiteMode;
  /** unpublished edits belong to the site on screen: publish or discard them first */
  dirty: boolean;
  onSwitched: () => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<SiteMode>(mode);
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) setPick(mode);
  }, [open, mode]);
  const change = useMutation({
    mutationFn: (m: SiteMode) => api.setSite(m),
    onSuccess: async (_r, m) => {
      await qc.invalidateQueries({ queryKey: qk.appearance });
      setOpen(false);
      onSwitched();
      toast(`Pronto: a loja passa a mostrar o ${SITES[m].label.toLowerCase()} em até 1 minuto.`);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const Current = SITES[mode].Icon;
  // a radiogroup: the arrows move the choice, Tab leaves the group
  const onKey = (e: KeyboardEvent) => {
    const step = ['ArrowDown', 'ArrowRight'].includes(e.key)
      ? 1
      : ['ArrowUp', 'ArrowLeft'].includes(e.key)
        ? -1
        : 0;
    if (!step) return;
    e.preventDefault();
    const next = ORDER[(ORDER.indexOf(pick) + step + ORDER.length) % ORDER.length]!;
    setPick(next);
    group.current?.querySelector<HTMLElement>(`[data-site="${next}"]`)?.focus();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          'press t-label inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-surface pl-3 pr-2.5 ring-1 ring-line-strong hover:bg-hover',
          className,
        )}
      >
        <Current className="size-5 shrink-0 text-primary" weight="duotone" />
        <span className="truncate">{SITES[mode].label}</span>
        <CaretDown className="size-4 shrink-0 text-muted" />
        <span className="sr-only">: trocar o site da loja</span>
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Qual site a loja mostra?"
        description="Cada um guarda o próprio layout e as próprias cores, com as suas edições. Dá para voltar quando quiser."
        footer={
          <Button
            block
            disabled={pick === mode || dirty}
            loading={change.isPending}
            onClick={() => change.mutate(pick)}
          >
            {pick === mode ? 'é o site no ar' : `mostrar o ${SITES[pick].label.toLowerCase()}`}
          </Button>
        }
      >
        <div
          ref={group}
          role="radiogroup"
          aria-label="site da loja"
          onKeyDown={onKey}
          className="grid gap-3"
        >
          {ORDER.map((m) => {
            const s = SITES[m];
            const on = pick === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                data-site={m}
                onClick={() => setPick(m)}
                className={cn(
                  'press-row flex min-h-20 w-full items-start gap-3 rounded-md bg-surface px-4 py-3.5 text-left hover:bg-hover',
                  on ? 'ring-2 ring-primary' : 'ring-1 ring-line',
                )}
              >
                <s.Icon className="mt-0.5 size-6 shrink-0 text-primary" weight="duotone" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                    {s.label}
                    {m === mode ? (
                      <span className="t-caption rounded-full bg-success-soft px-2 py-0.5 font-normal text-success">
                        no ar
                      </span>
                    ) : null}
                  </span>
                  <span className="t-caption block text-muted">{s.hint}</span>
                </span>
                {on ? (
                  <CheckCircle className="mt-0.5 size-6 shrink-0 text-primary" weight="fill" />
                ) : (
                  <Circle className="mt-0.5 size-6 shrink-0 text-faint" />
                )}
              </button>
            );
          })}
        </div>
        {dirty && pick !== mode ? (
          <Notice tone="warning" title="Você tem mudanças não publicadas" className="mt-4">
            Elas são do site que está no ar agora. Publique ou descarte antes de trocar.
          </Notice>
        ) : null}
      </Sheet>
    </>
  );
}
