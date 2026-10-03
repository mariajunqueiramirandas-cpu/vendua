import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { when } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Segmented } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { TPLS, tplLabel, type TplId } from './useEditor.ts';

/** Published versions of one template; it opens on the one being edited. */
export function HistorySheet({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: TplId;
}) {
  const qc = useQueryClient();
  const [tpl, setTpl] = useState<TplId>(initial);
  useEffect(() => {
    if (open) setTpl(initial);
  }, [open, initial]);
  const { data } = useQuery({
    queryKey: ['appearance', 'history', tpl],
    queryFn: () => api.pageHistory(tpl),
    enabled: open,
  });
  const restore = useMutation({
    mutationFn: (v: number) => api.restorePage(tpl, v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.appearance });
      void qc.invalidateQueries({ queryKey: ['appearance', 'history', tpl] });
      toast('Versão restaurada e publicada ✓');
      onOpenChange(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const rows = data?.history ?? [];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Versões publicadas"
      description="Voltar a uma versão publica ela de novo. A atual continua no histórico."
    >
      <Segmented
        label="parte da loja"
        value={tpl}
        onChange={setTpl}
        className="mb-2"
        options={TPLS.map((t) => ({ value: t, label: tplLabel(t) }))}
      />
      {!data ? <RowsSkeleton rows={3} avatar={false} className="pt-1" /> : null}
      <ol className="divide-y divide-line pt-1">
        {rows.map((h, i) => (
          <li key={h.version} className="flex min-h-16 items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                Versão {h.version}{' '}
                {i === 0 ? (
                  <span className="t-caption rounded-full bg-success-soft px-2 py-0.5 text-success">
                    no ar
                  </span>
                ) : null}
              </p>
              <p className="t-caption text-muted">
                {when(h.at)} · {h.by}
              </p>
            </div>
            {i > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                loading={restore.isPending && restore.variables === h.version}
                onClick={() => restore.mutate(h.version)}
              >
                voltar a esta
              </Button>
            ) : null}
          </li>
        ))}
        {data && !rows.length ? (
          <li className="t-body py-4 text-muted">Ainda usa o modelo padrão: nada publicado.</li>
        ) : null}
      </ol>
    </Sheet>
  );
}
