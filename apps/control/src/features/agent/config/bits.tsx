import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api.ts';
import { ErrorState, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Textarea } from '@/components/ui/input.tsx';

/**
 * Local edit copy of a server value. A new server value (after any save or
 * refetch) replaces the draft.
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
