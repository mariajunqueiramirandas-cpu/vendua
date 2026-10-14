import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Copy, Handshake, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  ApiError,
  type NewPartner,
  type Partner,
  type PartnerKind,
  type PartnerPatch,
  type PartnerStatus,
  type StoreReferral,
} from '@/lib/api.ts';
import { fmtDate, fmtMoney } from '@/lib/format.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EditableText } from '@/components/EditableText.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, Fact } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { useStoresTabs } from './tabs.ts';

// Parceiros (migration 0120): accountants, suppliers and agencies who bring stores. They apply on
// the site and wait here as "pendente"; approved, their link earns them 20% of the plan invoices
// their stores pay in each store's first 12 months. Core sums what is due; staff send the Pix and
// record it here. Below, the store-to-store referrals (a month free each side).

const KIND: Record<PartnerKind, string> = {
  contador: 'contador',
  fornecedor: 'fornecedor',
  agencia: 'agência',
  consultor: 'consultor',
  outro: 'outro',
};
const KINDS = Object.entries(KIND) as [PartnerKind, string][];

const STATUS: Record<
  PartnerStatus,
  { label: string; variant: 'warn' | 'live' | 'default' | 'bad' }
> = {
  pending: { label: 'pendente', variant: 'warn' },
  active: { label: 'ativo', variant: 'live' },
  paused: { label: 'pausado', variant: 'default' },
  rejected: { label: 'recusado', variant: 'bad' },
};

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR')}%`;
const phoneOf = (p: string) =>
  p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : p;

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copiado`),
    () => toast.error('não deu para copiar'),
  );
}

function usePartners() {
  return useQuery({ queryKey: qk.partners(), queryFn: api.partners });
}

function usePatchPartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: PartnerPatch & { id: string }) => api.patchPartner(id, patch),
    onSuccess: () => toast.success('parceiro salvo'),
    onError: (e) => toast.error(`não salvou: ${errorMessage(e)}`),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.partners() }),
  });
}

export default function PartnersPage() {
  const tabs = useStoresTabs();
  const query = usePartners();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const partners = query.data?.partners ?? [];
  const id = sp.get('parceiro');
  const open = partners.find((p) => p.id === id) ?? null;
  const setOpen = (v: string | null) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (v) n.set('parceiro', v);
        else n.delete('parceiro');
        return n;
      },
      { replace: !v },
    );

  const columns: Column<Partner>[] = [
    {
      key: 'name',
      header: 'parceiro',
      className: 'w-full max-w-0',
      cell: (p) => (
        <button
          type="button"
          onClick={() => setOpen(p.id)}
          className="flex min-w-0 flex-col text-left"
        >
          <span className="truncate font-medium underline-offset-2 hover:underline">{p.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {KIND[p.kind]}
            {p.city ? ` · ${p.city}` : ''}
          </span>
        </button>
      ),
    },
    {
      key: 'status',
      header: 'estado',
      cell: (p) => <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>,
    },
    { key: 'stores', header: 'lojas', align: 'end', className: 'tnum', cell: (p) => p.stores },
    {
      key: 'due',
      header: 'a pagar',
      align: 'end',
      className: 'tnum whitespace-nowrap',
      cell: (p) => (p.dueCents ? <b className="font-medium">{fmtMoney(p.dueCents)}</b> : '—'),
    },
    {
      key: 'paid',
      header: 'já pago',
      align: 'end',
      className: 'tnum whitespace-nowrap text-muted-foreground',
      cell: (p) => (p.paidCents ? fmtMoney(p.paidCents) : '—'),
    },
  ];

  return (
    <Page title="Lojas" tabs={tabs}>
      <div className="flex flex-col gap-3">
        <Panel
          flush
          title="parceiros"
          aside={mobile ? undefined : 'contadores, fornecedores e agências que trazem lojas'}
          actions={
            <Button size="sm" variant="outline" onClick={() => setOpen('novo')}>
              <Plus />
              novo parceiro
            </Button>
          }
          className="overflow-hidden"
        >
          {query.isError && !query.data ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <DataList
              rows={partners}
              rowKey={(p) => p.id}
              columns={columns}
              loading={query.isPending}
              rowClassName={(p) =>
                p.status === 'rejected' || p.status === 'paused' ? 'opacity-55' : undefined
              }
              {...(mobile ? { onRowClick: (p: Partner) => setOpen(p.id) } : {})}
              mobileRow={(p) => (
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {KIND[p.kind]} · {p.stores} {p.stores === 1 ? 'loja' : 'lojas'}
                      {p.dueCents ? ` · ${fmtMoney(p.dueCents)} a pagar` : ''}
                    </span>
                  </div>
                  <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                </div>
              )}
              empty={
                <EmptyState
                  icon={Handshake}
                  title="nenhum parceiro ainda"
                  hint="quem se inscreve em vendua.com.br/parceiros/ aparece aqui para aprovar"
                />
              }
            />
          )}
        </Panel>

        <ReferralsPanel rows={query.data?.referrals ?? []} loading={query.isPending} />
      </div>

      <PartnerSheet partner={open} onClose={() => setOpen(null)} />
      <NewPartnerSheet open={id === 'novo'} onClose={() => setOpen(null)} />
    </Page>
  );
}

function ReferralsPanel({ rows, loading }: { rows: StoreReferral[]; loading: boolean }) {
  const columns: Column<StoreReferral>[] = [
    {
      key: 'store',
      header: 'loja nova',
      className: 'w-full max-w-0 truncate',
      cell: (r) => (
        <Link to={`/lojas/${r.tenantId}`} className="hover:underline">
          {r.name}
        </Link>
      ),
    },
    {
      key: 'by',
      header: 'indicada por',
      className: 'whitespace-nowrap',
      cell: (r) => r.referrer ?? '—',
    },
    {
      key: 'at',
      header: 'entrou',
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (r) => fmtDate(r.createdAt),
    },
    {
      key: 'month',
      header: 'mês de quem indicou',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (r) =>
        r.rewardedAt ? (
          <Badge variant="live">ganho</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">quando pagar o 1º mês</span>
        ),
    },
  ];
  return (
    <Panel
      flush
      title="indicações entre lojas"
      aside="um mês grátis para cada lado"
      className="overflow-hidden"
    >
      <DataList
        rows={rows}
        rowKey={(r) => r.tenantId}
        columns={columns}
        loading={loading}
        mobileRow={(r) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{r.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              por {r.referrer ?? '—'} · {r.rewardedAt ? 'mês ganho' : 'esperando o 1º pagamento'}
            </span>
          </div>
        )}
        empty={
          <EmptyState
            icon={Users}
            title="nenhuma indicação ainda"
            hint="cada loja tem o seu link em Conta e plano → Indique e ganhe"
          />
        }
      />
    </Panel>
  );
}

function PartnerSheet({ partner, onClose }: { partner: Partner | null; onClose: () => void }) {
  const qc = useQueryClient();
  const patch = usePatchPartner();
  const detail = useQuery({
    queryKey: qk.partner(partner?.id ?? ''),
    queryFn: () => api.partner(partner!.id),
    enabled: !!partner,
  });
  const pay = useMutation({
    mutationFn: (id: string) => api.payPartner(id, null),
    onSuccess: (r) => toast.success(`pagamento de ${fmtMoney(r.payout.totalCents)} registrado`),
    onError: (e) => toast.error(`não registrou: ${errorMessage(e)}`),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.partners() }),
  });
  const p = partner;
  const set = (s: PartnerStatus) => p && patch.mutate({ id: p.id, status: s });
  return (
    <ResponsiveSheet
      open={!!p}
      onOpenChange={(o) => !o && onClose()}
      title={p?.name ?? 'parceiro'}
      description={p ? `${KIND[p.kind]}${p.city ? ` · ${p.city}` : ''}` : undefined}
    >
      {p && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
            <div className="flex gap-2">
              {p.status !== 'active' && (
                <Button size="sm" disabled={patch.isPending} onClick={() => set('active')}>
                  aprovar
                </Button>
              )}
              {p.status === 'active' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={patch.isPending}
                  onClick={() => set('paused')}
                >
                  pausar
                </Button>
              )}
              {p.status === 'pending' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={patch.isPending}
                  onClick={() => set('rejected')}
                >
                  recusar
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Fact label="código">
              <span className="inline-flex items-center gap-1">
                <span className="font-mono text-[13px]">{p.code}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="copiar o código"
                  onClick={() => copy(p.code, 'código')}
                >
                  <Copy />
                </Button>
              </span>
            </Fact>
            <Fact label="comissão">
              {pct(p.commissionBps)} por {p.commissionMonths} meses
            </Fact>
            <Fact label="WhatsApp">{phoneOf(p.phone)}</Fact>
            <Fact label="e-mail">{p.email ?? '—'}</Fact>
          </div>
          {p.link && (
            <Button variant="outline" size="sm" onClick={() => copy(p.link!, 'link')}>
              <Copy />
              copiar o link do parceiro
            </Button>
          )}
          <Fact label="chave Pix (para o pagamento)">
            <EditableText
              value={p.pixKey ?? ''}
              label="chave Pix do parceiro"
              placeholder="CPF, CNPJ, e-mail, telefone ou aleatória"
              onSave={(v) => patch.mutate({ id: p.id, pixKey: v?.trim() || null })}
            />
          </Fact>
          <Fact label="nota">
            <EditableText
              value={p.note ?? ''}
              label="nota sobre o parceiro"
              placeholder="como chegou, o que combinamos"
              onSave={(v) => patch.mutate({ id: p.id, note: v?.trim() || null })}
            />
          </Fact>

          <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary p-3">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">a pagar agora</span>
              <span className="text-lg font-semibold tnum">{fmtMoney(p.dueCents)}</span>
            </div>
            <Button
              size="sm"
              disabled={!p.dueCents || pay.isPending}
              onClick={() => pay.mutate(p.id)}
              title="depois de mandar o Pix para a chave do parceiro"
            >
              registrar pagamento
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground/80">
              lojas ({detail.data?.stores.length ?? p.stores})
            </span>
            {detail.data?.stores.length ? (
              <ul className="flex flex-col gap-1">
                {detail.data.stores.map((s) => (
                  <li key={s.tenantId} className="flex min-w-0 items-baseline gap-2 text-sm">
                    <Link
                      to={`/lojas/${s.tenantId}`}
                      className="truncate underline-offset-2 hover:underline"
                    >
                      {s.name}
                    </Link>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {fmtDate(s.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">nenhuma loja ainda</p>
            )}
          </div>

          {detail.data?.commissions.length ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground/80">comissões</span>
              <ul className="flex flex-col gap-1">
                {detail.data.commissions.slice(0, 30).map((k) => (
                  <li key={k.id} className="flex min-w-0 items-baseline gap-2 text-sm">
                    <span className="truncate">
                      {k.store}
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        · fatura {k.invoiceNumber}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 tnum">{fmtMoney(k.commissionCents)}</span>
                    <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
                      {k.status === 'due' ? 'a pagar' : k.status === 'paid' ? 'pago' : 'anulado'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </ResponsiveSheet>
  );
}

function NewPartnerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<PartnerKind>('contador');
  const [f, setF] = useState({ name: '', phone: '', email: '', city: '', pixKey: '' });
  const [err, setErr] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (body: NewPartner) => api.createPartner(body),
    onSuccess: () => {
      toast.success('parceiro criado');
      setF({ name: '', phone: '', email: '', city: '', pixKey: '' });
      onClose();
    },
    onError: (e) =>
      setErr(
        e instanceof ApiError && e.code === 'PARTNER_EXISTS'
          ? 'já existe um parceiro com esse WhatsApp'
          : errorMessage(e),
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.partners() }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    create.mutate({
      name: f.name.trim(),
      kind,
      phone: f.phone,
      ...(f.email.trim() ? { email: f.email.trim() } : {}),
      ...(f.city.trim() ? { city: f.city.trim() } : {}),
      ...(f.pixKey.trim() ? { pixKey: f.pixKey.trim() } : {}),
    });
  };
  const input = (k: keyof typeof f, label: string, extra: Record<string, string> = {}) => (
    <Field label={label} htmlFor={`np-${k}`}>
      <Input
        id={`np-${k}`}
        value={f[k]}
        onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))}
        {...extra}
      />
    </Field>
  );
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="novo parceiro"
      description="entra já aprovado, com 20% por 12 meses"
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        {input('name', 'nome', { required: 'true', maxLength: '80' })}
        <Field label="tipo">
          <Segmented
            size="sm"
            value={kind}
            onChange={setKind}
            options={KINDS}
            label="tipo de parceiro"
            className="flex-wrap"
          />
        </Field>
        {input('phone', 'WhatsApp', { inputMode: 'tel', required: 'true' })}
        {input('email', 'e-mail', { type: 'email' })}
        {input('city', 'cidade')}
        {input('pixKey', 'chave Pix')}
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button type="submit" disabled={create.isPending || f.name.trim().length < 2}>
          criar parceiro
        </Button>
      </form>
    </ResponsiveSheet>
  );
}
