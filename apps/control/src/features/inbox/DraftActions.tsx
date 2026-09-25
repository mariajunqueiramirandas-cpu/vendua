import { useState, type ReactNode } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { ConfirmButton } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/input.tsx';
import { useApproveDraft, useEditDraft, useRejectDraft, type DraftRef } from './queries.ts';

/**
 * A pending draft's review controls: aprovar / editar / descartar, with the
 * edit swapping `children` (the preview) for an inline editor. Clicks don't
 * bubble so it can sit inside a clickable list row.
 */
export function DraftActions({
  draft,
  body,
  children,
  className,
}: {
  draft: DraftRef;
  body: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const approve = useApproveDraft();
  const reject = useRejectDraft();
  const edit = useEditDraft();
  const busy = approve.isPending || reject.isPending || edit.isPending;

  const saveEdit = () => {
    if (!editing?.trim() || busy) return;
    edit.mutate({ draft, body: editing }, { onSuccess: () => setEditing(null) });
  };

  return (
    <div
      className={cn('flex min-w-0 flex-col gap-2', className)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {editing !== null ? (
        <Textarea
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              saveEdit();
            } else if (e.key === 'Escape') setEditing(null);
          }}
          className="min-h-28"
          aria-label="editar rascunho"
          autoFocus
        />
      ) : (
        children
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {editing !== null ? (
          <>
            <Button size="sm" onClick={saveEdit} disabled={busy || !editing.trim()}>
              <Check /> {edit.isPending ? 'salvando…' : 'salvar + aprovar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              cancelar
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => approve.mutate(draft.id)} disabled={busy}>
              <Check /> {approve.isPending ? 'enviando…' : 'aprovar'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(body)} disabled={busy}>
              <Pencil /> editar
            </Button>
            <ConfirmButton
              size="sm"
              variant="ghost"
              confirm="descartar?"
              onConfirm={() => reject.mutate(draft.id)}
              disabled={busy}
            >
              <X /> descartar
            </ConfirmButton>
          </>
        )}
      </div>
    </div>
  );
}
