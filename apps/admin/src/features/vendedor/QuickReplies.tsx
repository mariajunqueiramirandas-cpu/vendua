import { Lightning, PencilSimple, Plus } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { ApiError, api, type QuickReply } from '../../lib/api.ts';
import { useMutation } from '../../lib/query.ts';
import { useCan } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { TextArea } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';

type Replies = { replies: QuickReply[] };

/** under the Vendedor root: the live `vendedor` topic refreshes it with the rest */
export const QUICK_KEY = ['vendedor', 'quick-replies'] as const;
const MAX = 30;
const LEN = 500;

const failText = (e: unknown) =>
  e instanceof ApiError && e.code === 'QUICK_REPLIES_FULL'
    ? `Já são ${MAX} respostas prontas. Apague uma para criar outra.`
    : messageOf(e);

/**
 * "Respostas prontas": the store's own short replies, a tap puts one in the composer to check
 * before sending. Everyone at the store uses them; managers write, change and delete them here.
 */
export function QuickRepliesSheet({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (text: string) => void;
}) {
  const qc = useQueryClient();
  const manager = useCan('manager');
  const q = useQuery({ queryKey: QUICK_KEY, queryFn: api.vendedor.quickReplies, enabled: open });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const put = (r: Replies) => qc.setQueryData(QUICK_KEY, r);
  const add = useMutation({
    mutationFn: (v: { text: string; position?: number }) =>
      api.vendedor.addQuickReply(v.text, v.position),
    onSuccess: (r) => {
      put(r);
      setEditing(null);
    },
    onError: (e) => toast.error(failText(e)),
  });
  const edit = useMutation({
    mutationFn: (v: { id: string; text: string }) => api.vendedor.updateQuickReply(v.id, v.text),
    onSuccess: (r) => {
      put(r);
      setEditing(null);
    },
    onError: (e) => toast.error(failText(e)),
  });
  const remove = useMutation({
    mutationFn: (r: QuickReply) => api.vendedor.deleteQuickReply(r.id),
    onSuccess: (r, gone) => {
      put(r);
      setEditing(null);
      toast('Resposta pronta apagada.', {
        undo: () => add.mutate({ text: gone.text, position: gone.position }),
      });
    },
    onError: (e) => toast.error(failText(e)),
  });
  const replies = q.data?.replies ?? [];
  const full = replies.length >= MAX;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setEditing(null);
      }}
      title="Respostas prontas"
      description="Toque numa para pôr na sua resposta. Você confere antes de mandar."
    >
      {q.isPending ? (
        <RowsSkeleton rows={3} avatar={false} />
      ) : q.error ? (
        <p className="t-body text-muted">Não deu para abrir as respostas agora. Tente de novo.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {replies.length ? (
            <ul className="-mx-2 flex flex-col">
              {replies.map((r) =>
                editing === r.id ? (
                  <li key={r.id} className="px-2 py-2">
                    <ReplyForm
                      initial={r.text}
                      busy={edit.isPending}
                      deleting={remove.isPending}
                      onSave={(text) => edit.mutate({ id: r.id, text })}
                      onDelete={() => remove.mutate(r)}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                ) : (
                  <li key={r.id} className="flex items-start gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onPick(r.text);
                        onOpenChange(false);
                      }}
                      className="press-row flex min-h-14 min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-3 text-left hover:bg-hover"
                    >
                      <Lightning
                        weight="bold"
                        className="mt-0.5 size-4 shrink-0 text-muted"
                        aria-hidden
                      />
                      <span className="t-body-lg line-clamp-3 min-w-0 leading-6 [overflow-wrap:anywhere]">
                        {r.text}
                      </span>
                    </button>
                    {manager ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1.5 h-11 shrink-0 text-muted"
                        icon={<PencilSimple weight="bold" />}
                        aria-label={`editar: ${r.text.slice(0, 60)}`}
                        onClick={() => setEditing(r.id)}
                      >
                        editar
                      </Button>
                    ) : null}
                  </li>
                ),
              )}
            </ul>
          ) : (
            <div className="rounded-md bg-sunken px-4 py-4">
              <p className="font-semibold">Nenhuma resposta pronta ainda.</p>
              <p className="t-body mt-1 text-muted">
                {manager
                  ? 'Guarde aqui o que você mais manda: a chave Pix, o horário, "já saiu para entrega".'
                  : 'Peça para quem gerencia a loja guardar as respostas que vocês mais mandam.'}
              </p>
            </div>
          )}
          {manager ? (
            editing === 'new' ? (
              <ReplyForm
                busy={add.isPending}
                onSave={(text) => add.mutate({ text })}
                onCancel={() => setEditing(null)}
              />
            ) : full ? (
              <p className="t-caption text-muted">
                {MAX} de {MAX} respostas. Apague uma para criar outra.
              </p>
            ) : (
              <Button
                variant="secondary"
                icon={<Plus weight="bold" />}
                className="self-start"
                onClick={() => setEditing('new')}
              >
                nova resposta pronta
              </Button>
            )
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function ReplyForm({
  initial = '',
  busy,
  deleting,
  onSave,
  onDelete,
  onCancel,
}: {
  initial?: string;
  busy: boolean;
  deleting?: boolean;
  onSave: (text: string) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (t) onSave(t);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <label htmlFor={id} className="t-label">
        {initial ? 'Resposta pronta' : 'Nova resposta pronta'}
      </label>
      <TextArea
        id={id}
        autoFocus
        value={text}
        maxLength={LEN}
        rows={3}
        placeholder="Ex.: Seu pedido já saiu para entrega!"
        onChange={(e) => setText(e.target.value)}
        className="min-h-24"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={busy} disabled={!text.trim() || text.trim() === initial}>
          salvar
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          cancelar
        </Button>
        {onDelete ? (
          <Button
            variant="ghost"
            className="ml-auto text-danger"
            loading={!!deleting}
            onClick={onDelete}
          >
            apagar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
