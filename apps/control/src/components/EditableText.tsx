import { useRef, useState, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn.ts';
import { Input } from './ui/input.tsx';

/** Shared look for click-to-edit values: reads as text, highlights as a control on hover/focus. */
export const editableValueClass =
  'inline-flex min-h-7 max-w-full min-w-0 items-center rounded-md px-1.5 -mx-1.5 text-left text-sm transition-colors hover:bg-hover focus-visible:bg-hover pointer-coarse:min-h-9';

/**
 * Click-to-edit text. Enter/blur commits via onSave, Escape cancels,
 * an empty value saves as null.
 */
export function EditableText({
  value,
  onSave,
  placeholder = '—',
  type,
  inputMode,
  label,
  className,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  placeholder?: string | undefined;
  type?: InputHTMLAttributes<HTMLInputElement>['type'] | undefined;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'] | undefined;
  /** accessible name for the control (the visible label usually sits elsewhere) */
  label?: string | undefined;
  className?: string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  // Enter/Escape already resolved the edit — an unmount blur must not save again.
  const settled = useRef(false);

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(editableValueClass, className)}
        title="clique para editar"
        aria-label={label ? `editar ${label}` : undefined}
        onClick={() => {
          settled.current = false;
          setV(value ?? '');
          setEditing(true);
        }}
      >
        <span className="truncate">
          {value ?? <span className="text-muted-foreground/70">{placeholder}</span>}
        </span>
      </button>
    );
  }
  return (
    <Input
      autoFocus
      value={v}
      type={type}
      inputMode={inputMode}
      aria-label={label}
      placeholder={placeholder}
      className={className}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          settled.current = true;
          const next = v.trim() || null;
          if (next !== value) onSave(next);
          setEditing(false);
        }
        if (e.key === 'Escape') {
          settled.current = true;
          setEditing(false);
        }
      }}
      onBlur={() => {
        const next = v.trim() || null;
        if (!settled.current && next !== value) onSave(next);
        setEditing(false);
      }}
    />
  );
}
