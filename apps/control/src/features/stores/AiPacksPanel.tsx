import { useSearchParams } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import { toast } from 'sonner';
import type { AiPack } from '@/lib/api.ts';
import { fmtMoney } from '@/lib/format.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EditableText } from '@/components/EditableText.tsx';
import { MoneyEdit } from '@/components/MoneyEdit.tsx';
import { EmptyState, ErrorState, Fact } from '@/components/common.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { AI_MAX, CountEdit, convLabel } from './planEdit.tsx';
import { useAiPacks, usePatchAiPack } from './queries.ts';

function usePackEditors() {
  const patch = usePatchAiPack();
  return {
    name: (p: AiPack) => (
      <EditableText
        value={p.name}
        label={`nome do pacote ${p.id}`}
        className="font-medium"
        onSave={(v) => {
          const name = v?.trim() ?? '';
          if (name.length < 2 || name.length > 40)
            return void toast.error('o nome precisa ter de 2 a 40 caracteres');
          patch.mutate({ id: p.id, name });
        }}
      />
    ),
    conversations: (p: AiPack) => (
      <CountEdit
        value={p.conversations}
        label={`conversas do pacote ${p.name}`}
        unit="conversas"
        min={1}
        max={AI_MAX}
        display={(n) => `+${convLabel(n)}`}
        rangeError={`o pacote vai de 1 a ${AI_MAX.toLocaleString('pt-BR')} conversas`}
        onSave={(conversations) => patch.mutate({ id: p.id, conversations })}
      />
    ),
    price: (p: AiPack) => (
      <MoneyEdit
        cents={p.priceCents}
        label={`preço do pacote ${p.name}`}
        onSave={(cents) => {
          if (cents == null || cents < 100 || cents > 10_000_000)
            return void toast.error('o preço vai de R$ 1 a R$ 100.000');
          patch.mutate({ id: p.id, priceCents: cents });
        }}
      />
    ),
    public: (p: AiPack) => (
      <Switch
        checked={p.public}
        aria-label={`pacote ${p.name} à venda no admin`}
        disabled={patch.isPending}
        onCheckedChange={(v) => patch.mutate({ id: p.id, public: v })}
      />
    ),
  };
}

/** Duá's extra-conversation packs stores buy in the admin. */
export function AiPacksPanel() {
  const query = useAiPacks();
  const ed = usePackEditors();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const packs = [...(query.data ?? [])].sort((a, b) => a.sort - b.sort);
  const open = packs.find((p) => p.id === sp.get('pacote')) ?? null;
  const setOpen = (id: string | null) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (id) n.set('pacote', id);
        else n.delete('pacote');
        return n;
      },
      { replace: !id },
    );

  const columns: Column<AiPack>[] = [
    {
      key: 'name',
      header: 'pacote',
      className: 'max-w-[16rem]',
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-2">
          {ed.name(p)}
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{p.id}</span>
        </div>
      ),
    },
    { key: 'conv', header: 'conversas', className: 'whitespace-nowrap', cell: ed.conversations },
    { key: 'price', header: 'preço', className: 'w-full whitespace-nowrap', cell: ed.price },
    {
      key: 'public',
      header: 'no admin',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (p) => (
        <span className="inline-flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{p.public ? 'à venda' : 'oculto'}</span>
          {ed.public(p)}
        </span>
      ),
    },
  ];

  const mobileRow = (p: AiPack) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-medium">{p.name}</span>
        <span className="ml-auto shrink-0 text-sm tnum">{fmtMoney(p.priceCents)}</span>
      </div>
      <span className="text-xs text-muted-foreground tnum">
        +{convLabel(p.conversations)} · {p.public ? 'à venda' : 'oculto'}
      </span>
    </div>
  );

  return (
    <Panel
      flush
      title="pacotes do Duá"
      aside={mobile ? undefined : 'conversas extras que a loja compra no admin · valem 30 dias'}
      className="overflow-hidden"
    >
      {query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <DataList
          rows={packs}
          rowKey={(p) => p.id}
          columns={columns}
          mobileRow={mobileRow}
          {...(mobile ? { onRowClick: (p: AiPack) => setOpen(p.id) } : {})}
          loading={query.isPending}
          empty={<EmptyState icon={MessagesSquare} title="nenhum pacote cadastrado" />}
        />
      )}
      <ResponsiveSheet
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open?.name ?? 'pacote'}
        description={open?.id}
      >
        {open && (
          <div className="flex flex-col gap-3">
            <Fact label="nome">{ed.name(open)}</Fact>
            <Fact label="conversas">{ed.conversations(open)}</Fact>
            <Fact label="preço">{ed.price(open)}</Fact>
            <div className="flex items-center justify-between gap-3">
              <Fact label="no admin">{open.public ? 'à venda' : 'oculto'}</Fact>
              {ed.public(open)}
            </div>
            <p className="text-xs text-muted-foreground">
              um preço novo vale para as próximas compras; um pacote já cobrado mantém o valor
            </p>
          </div>
        )}
      </ResponsiveSheet>
    </Panel>
  );
}
