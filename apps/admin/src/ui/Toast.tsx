import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useSyncExternalStore } from 'react';
import { cn } from './cn.ts';

// Undo beats confirm (§2.2.1): reversible actions happen at once and offer
// "desfazer" for 6 s. Bottom on phones (above the nav), bottom-right on desktop; max 2.

export interface ToastItem {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
  undo?: () => void;
  action?: { label: string; run: () => void };
  ms: number;
}

let items: ToastItem[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function toast(
  text: string,
  opts: {
    tone?: ToastItem['tone'];
    undo?: () => void;
    action?: ToastItem['action'];
    ms?: number;
  } = {},
) {
  const t: ToastItem = {
    id: ++seq,
    text,
    tone: opts.tone ?? 'ok',
    ms: opts.ms ?? (opts.undo ? 6000 : 3500),
    ...(opts.undo ? { undo: opts.undo } : {}),
    ...(opts.action ? { action: opts.action } : {}),
  };
  items = [...items, t].slice(-2);
  emit();
  return t.id;
}
toast.error = (text: string) => toast(text, { tone: 'error', ms: 6000 });
export function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function useToasts() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => items,
  );
}

function One({ t }: { t: ToastItem }) {
  useEffect(() => {
    const h = setTimeout(() => dismiss(t.id), t.ms);
    return () => clearTimeout(h);
  }, [t.id, t.ms]);
  return (
    <div
      role={t.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'animate-fade-up pointer-events-auto flex min-h-14 w-full items-center gap-3 rounded-md px-4 py-2 depth-3',
        'bg-ink text-bg noite:bg-raised noite:text-ink',
      )}
    >
      {t.tone === 'error' ? (
        <WarningCircle weight="fill" className="size-5 shrink-0 text-[#ff8a7f]" aria-hidden />
      ) : t.tone === 'ok' ? (
        <CheckCircle weight="fill" className="size-5 shrink-0 text-spark" aria-hidden />
      ) : null}
      <p className="t-body min-w-0 flex-1 font-medium">{t.text}</p>
      {t.undo ? (
        <button
          type="button"
          onClick={() => {
            t.undo!();
            dismiss(t.id);
          }}
          className="t-label min-h-11 rounded-sm px-3 text-spark hover:bg-white/10"
        >
          desfazer
        </button>
      ) : t.action ? (
        <button
          type="button"
          onClick={() => {
            t.action!.run();
            dismiss(t.id);
          }}
          className="t-label min-h-11 rounded-sm px-3 text-spark hover:bg-white/10"
        >
          {t.action.label}
        </button>
      ) : (
        <button
          type="button"
          aria-label="fechar"
          onClick={() => dismiss(t.id)}
          className="grid size-10 place-items-center rounded-full opacity-70 hover:opacity-100"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function Toaster() {
  const list = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6 md:left-auto md:right-6 md:w-[420px] md:items-end"
    >
      {list.map((t) => (
        <One key={t.id} t={t} />
      ))}
    </div>
  );
}
