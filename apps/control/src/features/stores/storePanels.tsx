import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { CustomerDetail, StoreWhatsappState } from '@/lib/api.ts';
import { fmtDate, fmtDateTime, fmtMoney, rel } from '@/lib/format.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { Fact } from '@/components/common.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { SheetSection, Tag } from './bits.tsx';
import { AiMeter } from './fleetBits.tsx';

type Variant = 'default' | 'warn' | 'bad' | 'live';
type Tone = { label: string; variant: Variant };

const WA_STATE: Record<StoreWhatsappState, Tone> = {
  off: { label: 'desligado', variant: 'default' },
  connecting: { label: 'conectando', variant: 'default' },
  pairing: { label: 'aguardando QR', variant: 'warn' },
  open: { label: 'conectado', variant: 'live' },
  logged_out: { label: 'desconectado', variant: 'bad' },
  banned: { label: 'banido', variant: 'bad' },
  error: { label: 'com erro', variant: 'bad' },
};

const PROBE: Record<CustomerDetail['storefront']['probe'], Tone> = {
  ok: { label: 'no ar', variant: 'live' },
  failing: { label: 'falhando', variant: 'bad' },
  unknown: { label: 'sem sonda', variant: 'default' },
};

const INVOICE_STATUS: Record<CustomerDetail['invoices'][number]['status'], Tone> = {
  open: { label: 'em aberto', variant: 'warn' },
  paid: { label: 'paga', variant: 'live' },
  failed: { label: 'falhou', variant: 'bad' },
  void: { label: 'anulada', variant: 'default' },
};

const KIND: Record<string, string> = {
  period: 'mensalidade',
  upgrade: 'troca de plano',
  ai_pack: 'pacote de IA',
};
const ROLE: Record<string, string> = {
  owner: 'dono',
  staff: 'equipe',
  manager: 'gerente',
  attendant: 'atendente',
};

/** "há 3d" with the exact time on hover; "nunca" when absent. */
function Seen({ at, never = 'nunca' }: { at: string | null; never?: string }) {
  if (!at) return <span className="text-muted-foreground/70">{never}</span>;
  return (
    <span className="tnum" title={fmtDateTime(at)}>
      {rel(at) === 'agora' ? 'agora' : `há ${rel(at)}`}
    </span>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{children}</span>
    </div>
  );
}

export function AiPanel({ d }: { d: CustomerDetail }) {
  const ai = d.ai;
  return (
    <Panel
      title="Vendedor (IA)"
      actions={
        <Link to="/ia" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          uso de IA
        </Link>
      }
    >
      {!ai.included ? (
        <p className="text-sm text-muted-foreground">o plano desta loja não inclui o Vendedor</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">
              conversas {ai.period === 'trial' ? 'do teste' : 'do mês'}
            </span>
            <AiMeter ai={{ ...ai, packRemaining: 0 }} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="restantes">
              <span className="tnum">{ai.remaining}</span>
            </Fact>
            <Fact label="renova em">
              <span className="tnum">{ai.resetsAt ? fmtDate(ai.resetsAt) : '—'}</span>
            </Fact>
            <Fact label="em pacotes">
              <span className="tnum">{ai.packRemaining || '—'}</span>
            </Fact>
            <Fact label="pacote vence">
              <span className="tnum">
                {ai.packRemaining && ai.packExpiresAt ? fmtDate(ai.packExpiresAt) : '—'}
              </span>
            </Fact>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function ChannelsPanel({ d }: { d: CustomerDetail }) {
  const { store, whatsapp, printers, storefront } = d;
  return (
    <Panel title="canais">
      <div className="flex flex-col gap-4">
        <SheetSection
          title="WhatsApp da loja"
          aside={whatsapp ? <Tag map={WA_STATE} value={whatsapp.state} /> : undefined}
        >
          {whatsapp ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="estado desde">
                <Seen at={whatsapp.stateChangedAt} />
              </Fact>
              <Fact label="conectado em">
                <span className="tnum">{fmtDate(whatsapp.connectedAt)}</span>
              </Fact>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">a loja não conectou um número</p>
          )}
        </SheetSection>

        <SheetSection title="impressoras">
          {printers.length ? (
            <div className="flex flex-col gap-1.5">
              {printers.map((p) => (
                <Row key={p.id} label={p.name}>
                  visto <Seen at={p.lastSeenAt} />
                </Row>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">nenhuma impressora pareada</p>
          )}
        </SheetSection>

        <SheetSection title="loja virtual" aside={<Tag map={PROBE} value={storefront.probe} />}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="última sonda">
              <Seen at={storefront.lastProbeAt} never="—" />
            </Fact>
            <Fact label="incidentes abertos">
              <span
                className={
                  storefront.openIncidents ? 'font-medium text-destructive-foreground tnum' : 'tnum'
                }
              >
                {storefront.openIncidents}
              </span>
            </Fact>
            <Fact label="kernel">
              <span className="tnum">{storefront.kernel ?? '—'}</span>
            </Fact>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/lojas/frota?loja=${encodeURIComponent(store.slug)}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              ver na frota
            </Link>
            <a
              href={store.url}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <ExternalLink /> abrir site
            </a>
          </div>
        </SheetSection>
      </div>
    </Panel>
  );
}

type Invoice = CustomerDetail['invoices'][number];

const INVOICE_COLUMNS: Column<Invoice>[] = [
  { key: 'n', header: 'nº', className: 'tnum whitespace-nowrap', cell: (i) => i.number },
  {
    key: 'kind',
    header: 'tipo',
    className: 'whitespace-nowrap',
    cell: (i) => KIND[i.kind] ?? i.kind,
  },
  {
    key: 'status',
    header: 'status',
    cell: (i) => <Tag map={INVOICE_STATUS} value={i.status} />,
  },
  {
    key: 'due',
    header: 'vencimento',
    className: 'whitespace-nowrap tnum text-muted-foreground',
    cell: (i) => fmtDate(i.dueAt),
  },
  {
    key: 'paid',
    header: 'paga em',
    className: 'whitespace-nowrap tnum text-muted-foreground max-lg:hidden',
    cell: (i) => fmtDate(i.paidAt),
  },
  {
    key: 'amount',
    header: 'valor',
    align: 'end',
    className: 'whitespace-nowrap',
    cell: (i) => fmtMoney(i.amountCents),
  },
];

export function InvoicesPanel({ d }: { d: CustomerDetail }) {
  return (
    <Panel
      title="faturas"
      aside={d.invoices.length >= 12 ? 'as 12 mais recentes' : undefined}
      flush
    >
      <DataList
        rows={d.invoices}
        rowKey={(i) => i.id}
        columns={INVOICE_COLUMNS}
        mobileRow={(i) => (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium tnum">nº {i.number}</span>
              <span className="text-xs text-muted-foreground">{KIND[i.kind] ?? i.kind}</span>
              <span className="ml-auto text-sm font-medium tnum">{fmtMoney(i.amountCents)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Tag map={INVOICE_STATUS} value={i.status} />
              <span className="tnum">
                {i.paidAt ? `paga em ${fmtDate(i.paidAt)}` : `vence ${fmtDate(i.dueAt)}`}
              </span>
            </div>
          </div>
        )}
        empty={<p className="p-3 text-sm text-muted-foreground">nenhuma fatura ainda</p>}
      />
    </Panel>
  );
}

type User = CustomerDetail['users'][number];

const USER_COLUMNS: Column<User>[] = [
  {
    key: 'name',
    header: 'nome',
    className: 'max-w-[14rem] truncate',
    cell: (u) => u.name ?? <span className="text-muted-foreground/70">sem nome</span>,
  },
  {
    key: 'role',
    header: 'papel',
    className: 'whitespace-nowrap text-muted-foreground',
    cell: (u) => ROLE[u.role] ?? u.role,
  },
  {
    key: 'seen',
    header: 'último acesso',
    align: 'end',
    className: 'whitespace-nowrap',
    cell: (u) => <Seen at={u.lastSeenAt} />,
  },
];

export function UsersPanel({ d }: { d: CustomerDetail }) {
  return (
    <Panel title="usuários do painel" flush>
      <DataList
        rows={d.users}
        rowKey={(u) => u.id}
        columns={USER_COLUMNS}
        mobileRow={(u) => (
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{u.name ?? 'sem nome'}</span>
            <span className="text-xs text-muted-foreground">{ROLE[u.role] ?? u.role}</span>
            <span className="ml-auto shrink-0 text-xs">
              <Seen at={u.lastSeenAt} />
            </span>
          </div>
        )}
        empty={<p className="p-3 text-sm text-muted-foreground">nenhum usuário</p>}
      />
    </Panel>
  );
}
