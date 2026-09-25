import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ApiError } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { ErrorState, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Input, Textarea } from '@/components/ui/input.tsx';

/**
 * Local edit copy of a server value. A new server value (after any save or
 * refetch) replaces the draft — same as the old studio's reset-on-change.
 */
export function useDraft<T>(base: T) {
  const sig = JSON.stringify(base);
  const [edit, setEdit] = useState(base);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the value, not identity
  useEffect(() => setEdit(base), [sig]);
  return { edit, setEdit, dirty: JSON.stringify(edit) !== sig, reset: () => setEdit(base) };
}

/** Loading / unlanded (404) / failed state for an endpoint — says what lives here, never invents content. */
export function EndpointState({
  title,
  error,
  missing,
  onRetry,
}: {
  title: string;
  error: unknown;
  missing: string;
  onRetry: () => void;
}) {
  if (!error) return <LoadingRows rows={4} />;
  const notHere = error instanceof ApiError && error.status === 404;
  return (
    <Panel
      title={title}
      actions={
        notHere ? (
          <Badge variant="outline">rota ainda não neste servidor</Badge>
        ) : (
          <Badge variant="warn">falha ao ler</Badge>
        )
      }
    >
      {notHere ? (
        <p className="text-xs text-muted-foreground">{missing}</p>
      ) : (
        <ErrorState error={error} onRetry={onRetry} className="py-4" />
      )}
    </Panel>
  );
}

/** One muted line that says what an area is for. */
export function AreaIntro({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="min-w-0 flex-1 basis-64 text-xs text-muted-foreground">{children}</p>
      {aside}
    </div>
  );
}

/** Form footer — sticks to the bottom of the scroll area on phones so save stays in reach. */
export function SaveBar({
  dirty,
  disabled,
  pending,
  label,
  onSave,
  onReset,
  hint,
  extra,
}: {
  dirty: boolean;
  disabled?: boolean | undefined;
  pending?: boolean | undefined;
  label: string;
  onSave: () => void;
  onReset: () => void;
  hint?: ReactNode | undefined;
  extra?: ReactNode | undefined;
}) {
  return (
    <div
      className={cn(
        'mt-3 flex flex-wrap items-center gap-2',
        // phones: pending edits pin the bar to the bottom of the scroll area
        dirty &&
          'sticky bottom-0 z-10 -mx-3 -mb-3 border-t bg-card px-3 py-2 md:static md:mx-0 md:mb-0 md:border-t-0 md:bg-transparent md:px-0 md:py-0',
      )}
    >
      <Button disabled={!dirty || disabled || pending} onClick={onSave}>
        {label}
      </Button>
      {dirty && (
        <Button variant="ghost" onClick={onReset}>
          desfazer
        </Button>
      )}
      {extra}
      <span className="ml-auto text-xs text-muted-foreground">
        {hint ?? (dirty ? 'alterações não salvas' : '')}
      </span>
    </div>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  return <p className="text-xs text-destructive-foreground">{children}</p>;
}

const TZ_SUGGESTIONS = [
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Recife',
  'America/Bahia',
  'America/Manaus',
  'America/Belem',
  'America/Rio_Branco',
];

/** datalist for the timezone pickers — render once per page, inputs use `list="tz-list"`. */
export function TzList() {
  return (
    <datalist id="tz-list">
      {TZ_SUGGESTIONS.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  );
}

export function ListEditor({
  items,
  placeholder,
  addLabel = 'adicionar',
  max,
  maxLen,
  onChange,
}: {
  items: string[];
  placeholder: string;
  addLabel?: string | undefined;
  /** item-count ceiling — matches the backend cap (ignored phones 100, facts 100) */
  max?: number | undefined;
  /** per-item char cap — backend rejects longer strings */
  maxLen?: number | undefined;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  // settings arrive as untyped jsonb — coerce non-strings once so a re-save
  // passes the server-side validator
  const norm = items.map((it) => (typeof it === 'string' ? it : JSON.stringify(it)));
  const atMax = max !== undefined && items.length >= max;
  const add = () => {
    const v = draft.trim();
    if (!v || atMax) return;
    onChange([...norm, v]);
    setDraft('');
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ul className="divide-y rounded-md border">
        {norm.length === 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground">nada por aqui ainda</li>
        )}
        {norm.map((it, i) => (
          <li key={`${i}-${it.slice(0, 12)}`} className="flex min-h-9 items-start gap-2 px-2 py-1">
            <span className="w-5 shrink-0 pt-1 text-right text-[11px] text-muted-foreground tnum">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="min-w-0 flex-1 pt-0.5 text-sm break-words">{it}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              title="remover"
              aria-label={`remover ${it}`}
              onClick={() => onChange(norm.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={atMax && max !== undefined ? `máx ${max} — remova um item` : placeholder}
          maxLength={maxLen}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button
          variant="outline"
          onClick={add}
          disabled={!draft.trim() || atMax}
          title={atMax && max !== undefined ? `máx ${max} itens` : undefined}
        >
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

/** Escape hatch for keys the structured fields don't cover. */
export function RawJson({
  value,
  onSave,
}: {
  value: Record<string, unknown>;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState('');
  const save = () => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setErr('precisa ser um objeto JSON');
        return;
      }
      setErr('');
      onSave(parsed as Record<string, unknown>);
    } catch {
      setErr('JSON inválido');
    }
  };
  return (
    <details
      className="group mt-3 rounded-md border"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) setRaw(JSON.stringify(value, null, 2));
      }}
    >
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground select-none hover:text-foreground">
        json bruto
      </summary>
      <div className="flex flex-col gap-2 border-t p-3">
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          className="min-h-48 font-mono md:text-xs"
        />
        {err && <FieldError>{err}</FieldError>}
        <div>
          <Button variant="outline" size="sm" onClick={save}>
            salvar json
          </Button>
        </div>
      </div>
    </details>
  );
}
