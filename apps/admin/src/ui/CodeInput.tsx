import { ClipboardText } from '@phosphor-icons/react';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Button } from './Button.tsx';
import { cn } from './cn.ts';

export interface CodeInputHandle {
  focus: () => void;
}

/**
 * The 6-digit WhatsApp code: one box per digit, a pasted or autofilled code fills them all,
 * and a complete code calls onComplete (so the merchant never has to find a button).
 */
export const CodeInput = forwardRef<
  CodeInputHandle,
  {
    value: string;
    onChange: (code: string) => void;
    onComplete: (code: string) => void;
    invalid?: boolean;
    onPasteMiss?: () => void;
  }
>(function CodeInput({ value, onChange, onComplete, invalid, onPasteMiss }, ref) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  useImperativeHandle(ref, () => ({ focus: () => inputs.current[0]?.focus() }), []);
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;
  const setAt = (i: number, v: string) => {
    const d = v.replace(/\D/g, '');
    if (d.length > 1) {
      // pasted or autofilled the whole code
      const full = d.slice(0, 6);
      onChange(full);
      if (full.length === 6) onComplete(full);
      else inputs.current[full.length]?.focus();
      return;
    }
    const next = (value.slice(0, i) + d + value.slice(i + 1)).slice(0, 6);
    onChange(next);
    if (d && i < 5) inputs.current[i + 1]?.focus();
    if (next.length === 6 && /^\d{6}$/.test(next)) onComplete(next);
  };
  return (
    <>
      <fieldset>
        <legend className="sr-only">código de 6 números</legend>
        <div className="flex justify-between gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <input
              key={i}
              ref={(el) => (inputs.current[i] = el)}
              aria-label={`número ${i + 1}`}
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              autoFocus={i === 0}
              maxLength={i === 0 ? 6 : 1}
              value={value[i] ?? ''}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !value[i] && i > 0) inputs.current[i - 1]?.focus();
              }}
              aria-invalid={invalid ? true : undefined}
              className={cn(
                'tnum h-16 w-full min-w-0 rounded-md bg-sunken text-center font-display text-3xl font-semibold ring-1 ring-transparent',
                'focus:bg-surface focus:ring-2 focus:ring-primary focus:outline-none aria-invalid:ring-danger',
              )}
            />
          ))}
        </div>
      </fieldset>
      {canPaste && value.length < 6 ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          icon={<ClipboardText />}
          onClick={async () => {
            // WhatsApp's code message has a "copiar código" button
            const d = (await navigator.clipboard.readText().catch(() => '')).replace(/\D/g, '');
            if (d.length === 6) setAt(0, d);
            else onPasteMiss?.();
          }}
        >
          colar código
        </Button>
      ) : null}
    </>
  );
});
