import { useRef, useState } from 'react';
import { cn } from '@/lib/cn.ts';
import { fmtMoney } from '@/lib/format.ts';
import { editableValueClass } from './EditableText.tsx';
import { Input } from './ui/input.tsx';

/**
 * Click-to-edit BRL amount stored as cents. Accepts pt-BR input ("1.234,56");
 * empty clears to null, unparseable input is dropped.
 */
export function MoneyEdit({
  cents,
  onSave,
  label = 'valor',
  className,
}: {
  cents: number | null;
  onSave: (cents: number | null) => void;
  label?: string | undefined;
  className?: string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const settled = useRef(false);

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(editableValueClass, 'tnum', className)}
        title="clique para editar"
        aria-label={`editar ${label}`}
        onClick={() => {
          settled.current = false;
          setEditing(true);
        }}
      >
        {cents == null ? <span className="text-muted-foreground/70">R$ —</span> : fmtMoney(cents)}
      </button>
    );
  }
  const commit = (raw: string) => {
    if (settled.current) return;
    settled.current = true;
    const v = Number(raw.replace(/\./g, '').replace(',', '.'));
    if (raw === '') {
      if (cents !== null) onSave(null);
    } else if (!Number.isNaN(v) && Math.round(v * 100) !== cents) onSave(Math.round(v * 100));
    setEditing(false);
  };
  return (
    <Input
      autoFocus
      inputMode="decimal"
      aria-label={label}
      defaultValue={cents != null ? (cents / 100).toLocaleString('pt-BR') : ''}
      placeholder="R$"
      className={cn('w-36 tnum', className)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          settled.current = true;
          setEditing(false);
        }
        if (e.key === 'Enter') commit((e.target as HTMLInputElement).value.trim());
      }}
      onBlur={(e) => commit(e.target.value.trim())}
    />
  );
}
