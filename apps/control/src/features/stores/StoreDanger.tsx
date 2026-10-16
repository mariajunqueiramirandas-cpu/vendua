import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type CustomerRow } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { Dialog } from '@/components/ui/overlay.tsx';

type Kind = 'reset' | 'delete';

const COPY: Record<
  Kind,
  { label: string; hint: string; title: (n: string) => string; lead: string; action: string }
> = {
  reset: {
    label: 'zerar a loja',
    hint: 'volta ao começo do onboarding, como se tivesse acabado de se cadastrar',
    title: (n) => `zerar ${n}?`,
    lead: 'A loja fica pausada e o dono cai no Bem-vindo de novo, na primeira pergunta.',
    action: 'zerar loja',
  },
  delete: {
    label: 'apagar a loja',
    hint: 'some tudo, o endereço fica livre e a assinatura é cancelada',
    title: (n) => `apagar ${n}?`,
    lead: 'A loja, o endereço e todos os dados saem da Venduá.',
    action: 'apagar loja',
  },
};

const RESET_GOES =
  'cardápio e fotos, pedidos e pagamentos, clientes e conversas, cupons, entrega, PDV e cozinha, impressoras, WhatsApp da loja, equipe (fica só o dono), configurações e aparência';
const RESET_STAYS =
  'dono e login, endereço e domínios, plano, assinatura e faturas, site sob medida, auditoria e eventos';
const DELETE_GOES =
  'a assinatura é cancelada no Mercado Pago e os domínios próprios saem do Cloudflare; um domínio registrado pela Venduá deixa de ser renovado';

/** Staff wipe or remove the store. Each asks for the slug, typed. */
export function StoreDangerPanel({ store }: { store: CustomerRow }) {
  const [open, setOpen] = useState<Kind | null>(null);
  return (
    <Panel title="zerar ou apagar" className="border-destructive/30" flush>
      <div className="divide-y">
        {(['reset', 'delete'] as const).map((k) => (
          <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-56">
              <div className="text-[13px] font-medium">{COPY[k].label}</div>
              <p className="text-xs text-muted-foreground">{COPY[k].hint}</p>
            </div>
            <Button variant="destructive-outline" size="sm" onClick={() => setOpen(k)}>
              {k === 'reset' ? <RotateCcw /> : <Trash2 />}
              {k === 'reset' ? 'zerar' : 'apagar'}
            </Button>
          </div>
        ))}
      </div>
      {open && <ConfirmDialog kind={open} store={store} onClose={() => setOpen(null)} />}
    </Panel>
  );
}

function ConfirmDialog({
  kind,
  store,
  onClose,
}: {
  kind: Kind;
  store: CustomerRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  // one key per confirmation: a retry after a lost answer replays instead of running again
  const [key] = useState(() => crypto.randomUUID());
  const c = COPY[kind];
  const ok = typed.trim().toLowerCase() === store.slug;

  const run = useMutation({
    mutationFn: async (): Promise<unknown> =>
      kind === 'reset'
        ? api.resetStore(store.id, typed, key)
        : api.deleteStore(store.id, typed, key),
    onSuccess: () => {
      if (kind === 'reset') {
        toast.success(`${store.name} foi zerada`, {
          description: 'a loja voltou ao começo do onboarding',
        });
        void qc.invalidateQueries({ queryKey: qk.customer(store.id) });
        void qc.invalidateQueries({ queryKey: qk.billingStore(store.id) });
        onClose();
        return;
      }
      toast.success(`${store.name} foi apagada`);
      navigate('/lojas', { replace: true });
      qc.removeQueries({ queryKey: qk.customer(store.id) });
      qc.removeQueries({ queryKey: qk.storeEvents(store.id, '').slice(0, 3) });
      qc.removeQueries({ queryKey: qk.billingStore(store.id) });
      // stale, not refetched here: the store page is still mounted and its reads would 404
      void qc.invalidateQueries({ queryKey: qk.customers(), refetchType: 'none' });
      void qc.invalidateQueries({ queryKey: qk.billingStores(), refetchType: 'none' });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok && !run.isPending) run.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !run.isPending && onClose()}
      title={c.title(store.name)}
      description="Não tem desfazer."
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm">{c.lead}</p>
        {kind === 'reset' ? (
          <dl className="grid gap-2 rounded-lg border bg-secondary px-3 py-2.5 text-xs">
            <div>
              <dt className="font-medium text-destructive-foreground">apaga</dt>
              <dd className="text-muted-foreground">{RESET_GOES}</dd>
            </div>
            <div>
              <dt className="font-medium">mantém</dt>
              <dd className="text-muted-foreground">{RESET_STAYS}</dd>
            </div>
          </dl>
        ) : (
          <p className="rounded-lg border bg-secondary px-3 py-2.5 text-xs text-muted-foreground">
            {DELETE_GOES}
          </p>
        )}
        <Field
          label={
            <>
              digite <span className="font-mono text-foreground select-all">{store.slug}</span> para
              confirmar
            </>
          }
          htmlFor={`store-${kind}-confirm`}
        >
          <Input
            id={`store-${kind}-confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={store.slug}
            disabled={run.isPending}
            className="font-mono"
          />
        </Field>
        {run.isError && (
          <p className="text-xs text-destructive-foreground" role="alert">
            {errorMessage(run.error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            cancelar
          </Button>
          <Button type="submit" variant="destructive" disabled={!ok || run.isPending}>
            {run.isPending ? (
              <Loader2 className="animate-spin" />
            ) : kind === 'reset' ? (
              <RotateCcw />
            ) : (
              <Trash2 />
            )}
            {c.action}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
