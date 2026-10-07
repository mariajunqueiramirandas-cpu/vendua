import { CheckCircle, Printer } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type PdvPrinterChoice } from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { useMutation } from '../../lib/query.ts';
import { useCan, useFeature, useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { Toggle } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';
import { isCode, pdvError } from './data.ts';

// Printing the comanda's bill and the caixa's report on the store's printers (ADR 0027). Core
// picks the printer when the store has one; with several it answers PRINTER_REQUIRED and the
// screen asks once, remembering the choice on this device.

export type PrintWhat = { kind: 'tab'; id: string; ways?: number } | { kind: 'caixa'; id: string };

interface Job {
  what: PrintWhat;
  printer?: PdvPrinterChoice;
  retried?: boolean;
}

const keyOf = (store: string) => `vendua-pdv-printer:${store}`;

function readPrinter(store: string): PdvPrinterChoice | null {
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(store)) ?? 'null') as PdvPrinterChoice | null;
    return v && typeof v.id === 'string' && typeof v.name === 'string' ? v : null;
  } catch {
    return null;
  }
}
function writePrinter(store: string, p: PdvPrinterChoice | null) {
  try {
    if (p) localStorage.setItem(keyOf(store), JSON.stringify(p));
    else localStorage.removeItem(keyOf(store));
  } catch {
    /* private mode: it asks again next time */
  }
}

export function usePdvPrint() {
  const session = useSession();
  const store = session.store.id;
  const manager = useCan('manager');
  const nav = useNavigate();
  const available = useFeature('printing');
  const [saved, setSaved] = useState(() => readPrinter(store));
  const [ask, setAsk] = useState<{ what: PrintWhat; printers: PdvPrinterChoice[] } | null>(null);

  const remember = (p: PdvPrinterChoice | null) => {
    writePrinter(store, p);
    setSaved(p);
  };

  const again = useRef<(v: Job) => void>(() => undefined);
  const send = useMutation({
    mutationFn: (v: Job) => {
      const printerId = v.printer?.id;
      return v.what.kind === 'tab'
        ? api.pdv.printTab(v.what.id, {
            ...(printerId ? { printerId } : {}),
            ...(v.what.ways ? { ways: v.what.ways } : {}),
          })
        : api.pdv.printCaixa(v.what.id, printerId ? { printerId } : {});
    },
    onSuccess: (_r, v) => {
      haptic.commit();
      const what = v.what.kind === 'tab' ? 'A conta' : 'O relatório do caixa';
      toast(v.printer ? `${what} foi para ${v.printer.name}.` : `${what} foi para a impressora.`);
    },
    onError: (e, v) => {
      haptic.error();
      if (isCode(e, 'PRINTER_REQUIRED')) {
        const printers = Array.isArray(e.details?.printers)
          ? (e.details.printers as PdvPrinterChoice[])
          : [];
        if (v.printer) remember(null);
        if (printers.length) return setAsk({ what: v.what, printers });
      }
      if (isCode(e, 'NO_PRINTERS'))
        return toast(pdvError(e), {
          tone: 'error',
          ms: 8000,
          ...(manager ? { action: { label: 'impressoras', run: () => nav('/impressoras') } } : {}),
        });
      if (isCode(e, 'PLAN_REQUIRED'))
        return toast.error('Imprimir pela impressora da loja não está no plano de agora.');
      // the remembered printer is gone (removed, renamed away): forget it and let Core choose
      if (v.printer && !v.retried && e instanceof ApiError && e.status >= 400 && e.status < 500) {
        remember(null);
        return again.current({ what: v.what, retried: true });
      }
      toast.error(pdvError(e));
    },
  });

  again.current = send.mutate;

  return {
    /** the plan prints: without it there's no "imprimir" at all */
    available,
    pending: send.isPending,
    saved,
    forget: () => remember(null),
    print: (what: PrintWhat) => {
      if (send.isPending) return;
      send.mutate({ what, ...(saved ? { printer: saved } : {}) });
    },
    sheet: (
      <PrinterSheet
        choice={ask}
        busy={send.isPending}
        onClose={() => setAsk(null)}
        onPick={(p, keep) => {
          if (!ask) return;
          if (keep) remember(p);
          send.mutate({ what: ask.what, printer: p });
          setAsk(null);
        }}
      />
    ),
  };
}

function PrinterSheet({
  choice,
  busy,
  onClose,
  onPick,
}: {
  choice: { what: PrintWhat; printers: PdvPrinterChoice[] } | null;
  busy: boolean;
  onClose: () => void;
  onPick: (p: PdvPrinterChoice, keep: boolean) => void;
}) {
  const [keep, setKeep] = useState(true);
  const [shown, setShown] = useState(choice);
  if (choice && choice !== shown) setShown(choice);
  const c = choice ?? shown;
  return (
    <Sheet
      open={!!choice}
      onOpenChange={(o) => !o && onClose()}
      title="Em qual impressora?"
      description="A loja tem mais de uma ligada agora."
    >
      <div className="space-y-4 pb-2">
        <ul className="space-y-2" aria-label="impressoras">
          {(c?.printers ?? []).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(p, keep)}
                className={cn(
                  'press flex min-h-14 w-full items-center gap-3 rounded-md bg-surface px-4 text-left ring-1 ring-line-strong hover:bg-hover disabled:opacity-60',
                )}
              >
                <Printer weight="duotone" className="size-6 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <Toggle
          checked={keep}
          onChange={setKeep}
          label="Lembrar neste aparelho"
          description="As próximas contas e relatórios saem nela sem perguntar."
        />
      </div>
    </Sheet>
  );
}

/** "imprimir" plus, once a printer is remembered here, which one and a way to change it. */
export function PrintButton({
  printing,
  what,
  label = 'imprimir',
  className,
  size = 'sm',
}: {
  printing: ReturnType<typeof usePdvPrint>;
  what: PrintWhat;
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  if (!printing.available) return null;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <Button
        variant="secondary"
        size={size}
        icon={<Printer />}
        loading={printing.pending}
        onClick={() => printing.print(what)}
        className={size === 'sm' ? 'min-h-11' : undefined}
      >
        {label}
      </Button>
      {printing.saved ? (
        <span className="t-caption inline-flex items-center gap-1 text-muted">
          <CheckCircle weight="fill" className="size-3.5 shrink-0" aria-hidden />
          <span className="max-w-[10rem] truncate">{printing.saved.name}</span>
          <button
            type="button"
            onClick={printing.forget}
            className="min-h-11 px-1 font-semibold underline underline-offset-2 hover:text-ink"
            aria-label={`trocar a impressora (agora ${printing.saved.name})`}
          >
            trocar
          </button>
        </span>
      ) : null}
    </span>
  );
}
