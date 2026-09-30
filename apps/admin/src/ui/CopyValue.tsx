import { Check, Copy } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { haptic } from '../lib/haptics.ts';
import { Button } from './Button.tsx';
import { cn } from './cn.ts';
import { toast } from './Toast.tsx';

/** Copy text; falls back to selecting it when the clipboard is off (http, old WebViews). */
export async function copyText(text: string, fallback?: HTMLElement | null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallback) {
      const r = document.createRange();
      r.selectNodeContents(fallback);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
    }
    return false;
  }
}

/** A value the merchant pastes somewhere else (a DNS record, a Pix code): shown whole, one tap copies. */
export function CopyValue({
  label,
  value,
  copied = 'Copiado',
  className,
  lines,
}: {
  label: string;
  value: string;
  /** the toast after copying */
  copied?: string;
  className?: string;
  /** clamp a long value (a Pix code) to this many lines */
  lines?: number;
}) {
  const [done, setDone] = useState(false);
  const box = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2200);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <div className={cn('min-w-0', className)}>
      <p className="t-caption mb-1 text-muted">{label}</p>
      <div className="flex items-center gap-2 rounded-sm bg-sunken py-1.5 pl-3 pr-1.5">
        <p
          ref={box}
          className={cn(
            'tnum min-w-0 flex-1 select-all break-all font-mono text-[0.875rem] leading-5',
            lines === 2 && 'line-clamp-2',
            lines === 3 && 'line-clamp-3',
          )}
        >
          {value}
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          icon={done ? <Check weight="bold" /> : <Copy />}
          aria-label={`copiar ${label}`}
          onClick={async () => {
            if (await copyText(value, box.current)) {
              haptic.tick();
              setDone(true);
              toast(copied);
            } else toast('Selecionamos o texto: segure e toque em copiar.', { tone: 'info' });
          }}
        >
          {done ? 'copiado' : 'copiar'}
        </Button>
      </div>
    </div>
  );
}
