import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Pin, Trash2 } from 'lucide-react';
import { api, type MemoryItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { rel } from '@/lib/format.ts';
import { ConfirmButton } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/input.tsx';

type Op = { kind: 'pin'; pinned: boolean } | { kind: 'edit'; content: string } | { kind: 'delete' };

/** One memory item: pin toggle · text (tap to edit) · meta · delete. */
export function MemoryRow({
  m,
  onChanged,
  onError,
}: {
  m: MemoryItem;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const op = useMutation({
    mutationFn: (o: Op): Promise<unknown> =>
      o.kind === 'delete'
        ? api.deleteMemory(m.id)
        : api.patchMemory(m.id, o.kind === 'pin' ? { pinned: o.pinned } : { content: o.content }),
    onSuccess: (_, o) => {
      // an edit closes only once it landed — a failed save never discards typed text
      if (o.kind === 'edit') setEditing(false);
      onChanged();
    },
    onError,
  });

  return (
    <li className={cn('flex items-start gap-2 px-2 py-2', m.pinned && 'bg-agent-soft/60')}>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(m.pinned && 'bg-agent text-agent-foreground hover:bg-agent/85')}
        title={m.pinned ? 'soltar' : 'fixar — sempre entra no contexto'}
        aria-label={m.pinned ? 'soltar' : 'fixar'}
        aria-pressed={m.pinned}
        disabled={op.isPending}
        onClick={() => op.mutate({ kind: 'pin', pinned: !m.pinned })}
      >
        <Pin className={cn(m.pinned && 'fill-current')} />
      </Button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              rows={3}
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              aria-label="editar memória"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!text.trim() || op.isPending}
                onClick={() => op.mutate({ kind: 'edit', content: text.trim() })}
              >
                salvar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                deixar
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            title="editar"
            className="-mx-1 block w-full rounded px-1 py-0.5 text-left text-sm break-words hover:bg-hover"
            onClick={() => {
              setEditing(true);
              setText(m.content);
            }}
          >
            {m.content}
          </button>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {m.segment && <Badge variant="outline">{m.segment}</Badge>}
          <Badge>{m.source === 'staff' ? 'equipe' : m.source}</Badge>
          {m.uses > 0 && <span className="tnum">{m.uses} usos</span>}
          <span className="tnum">{rel(m.updatedAt)}</span>
        </div>
      </div>
      <ConfirmButton
        variant="ghost"
        size="sm"
        className="px-2"
        confirm="apagar?"
        title="apagar"
        onConfirm={() => op.mutate({ kind: 'delete' })}
      >
        <Trash2 />
      </ConfirmButton>
    </li>
  );
}
