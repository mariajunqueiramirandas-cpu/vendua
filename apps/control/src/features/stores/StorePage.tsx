import { Link, useParams } from 'react-router-dom';
import { ExternalLink, SearchX } from 'lucide-react';
import { ApiError, type CustomerDetail } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtBrPhone } from '@/lib/contact.ts';
import { fmtDate, fmtMoney, fmtUsd } from '@/lib/format.ts';
import { RiskChips } from '@/features/overview/risk.tsx';
import { ContactLink } from '@/components/ContactLinks.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, KpiStrip, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { BillingSections } from './BillingSections.tsx';
import { StoreLink } from './bits.tsx';
import { LastOrder, SubChip } from './fleetBits.tsx';
import { isStoreId, useBillingStore, useCustomer } from './queries.ts';
import { Spark } from './Spark.tsx';
import { domainToDo, siteOpen } from './storeRows.tsx';
import { AiPanel, ChannelsPanel, InvoicesPanel, UsersPanel } from './storePanels.tsx';
import { StoreTimeline } from './StoreTimeline.tsx';

const gone = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 400);

function Missing() {
  return (
    <EmptyState
      icon={SearchX}
      title="loja não encontrada"
      hint="o link pode estar errado ou a loja foi removida"
      action={
        <Link to="/lojas" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          ver todas as lojas
        </Link>
      }
    />
  );
}

function Header({ d }: { d: CustomerDetail }) {
  const s = d.store;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
      <StoreLink store={s} className="text-sm" />
      <span className="inline-flex items-center gap-1.5">
        <span className="font-medium">{s.plan.name}</span>
        <SubChip sub={s.subscription} withMethod />
      </span>
      {s.status === 'suspended' && !s.risk.includes('suspended') && (
        <Badge variant="bad">suspensa</Badge>
      )}
      <RiskChips risk={s.risk} />
      <span className="text-xs text-muted-foreground md:ml-auto">
        cliente desde {fmtDate(s.createdAt)}
      </span>
      {d.owner && <Owner owner={d.owner} />}
    </div>
  );
}

/** Whom to call about the store: its owner, with WhatsApp / phone / email links. */
function Owner({ owner }: { owner: NonNullable<CustomerDetail['owner']> }) {
  return (
    <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <span>dono</span>
      <span className="truncate font-medium text-foreground">{owner.name ?? 'sem nome'}</span>
      <span className="inline-flex items-center">
        <span className="tnum select-all">{fmtBrPhone(owner.phone)}</span>
        <ContactLink kind="whatsapp" value={owner.phone} />
        <ContactLink kind="tel" value={owner.phone} />
      </span>
      {owner.email && (
        <span className="inline-flex min-w-0 items-center">
          <span className="truncate select-all">{owner.email}</span>
          <ContactLink kind="email" value={owner.email} />
        </span>
      )}
    </div>
  );
}

function Kpis({ d }: { d: CustomerDetail }) {
  const s = d.store;
  return (
    <KpiStrip
      items={[
        { label: 'MRR', value: s.mrrCents ? fmtMoney(s.mrrCents) : '—' },
        {
          label: 'pedidos 30d',
          value: s.orders.count30d.toLocaleString('pt-BR'),
          hint: s.orders.lastAt ? (
            <>
              último há <LastOrder at={s.orders.lastAt} />
            </>
          ) : (
            'nenhum ainda'
          ),
        },
        { label: 'GMV 30d', value: fmtMoney(s.orders.gmv30dCents) },
        {
          label: 'conversas de IA',
          value: d.ai.included ? `${d.ai.used}/${d.ai.limit}` : '—',
          tone: d.ai.included && d.ai.remaining <= 0 ? 'bad' : undefined,
          hint: d.ai.included
            ? d.ai.packRemaining
              ? `+${d.ai.packRemaining} em pacotes`
              : d.ai.period === 'trial'
                ? 'no teste'
                : 'neste mês'
            : 'fora do plano',
        },
        { label: 'gasto de IA 30d', value: fmtUsd(s.ai.spend30dUsd) },
      ]}
    />
  );
}

function Charts({ d }: { d: CustomerDetail }) {
  const days = d.daily.map((p) => p.day);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Panel title="pedidos por dia" aside="30 dias">
        <Spark
          days={days}
          values={d.daily.map((p) => p.orders)}
          label="pedidos"
          format={(v) => v.toLocaleString('pt-BR')}
          detail={(i) => (
            <div className="tnum">
              {fmtMoney(d.daily[i]?.gmvCents)} <span className="text-muted-foreground">GMV</span>
            </div>
          )}
          empty="nenhum pedido em 30 dias"
        />
      </Panel>
      <Panel title="gasto de IA por dia" aside="30 dias">
        <Spark
          days={days}
          values={d.daily.map((p) => p.aiUsd)}
          label="gasto"
          format={fmtUsd}
          detail={(i) => (
            <div className="tnum">
              {d.daily[i]?.conversations ?? 0}{' '}
              <span className="text-muted-foreground">conversas</span>
            </div>
          )}
          empty="nenhum gasto de IA em 30 dias"
        />
      </Panel>
    </div>
  );
}

function BillingPanel({ b }: { b: ReturnType<typeof useBillingStore> }) {
  return (
    <Panel title="assinatura e serviços">
      {b.data ? (
        <BillingSections store={b.data} />
      ) : b.isPending ? (
        <LoadingRows rows={4} />
      ) : b.isError ? (
        <ErrorState error={b.error} onRetry={() => void b.refetch()} />
      ) : (
        <p className="text-sm text-muted-foreground">sem dados de cobrança para esta loja</p>
      )}
    </Panel>
  );
}

export default function StorePage() {
  const { id = '' } = useParams();
  const valid = isStoreId(id);
  const q = useCustomer(id);
  const billing = useBillingStore(id);
  const d = q.data;

  if (!d) {
    return (
      <Page title="Loja" back="/lojas">
        {!valid || gone(q.error) ? (
          <Missing />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <LoadingRows />
        )}
      </Page>
    );
  }

  const s = d.store;
  const b = billing.data;
  // on one column, a store with something to settle shows that before its charts
  const toDo = !!(s.openInvoice || domainToDo(b) || siteOpen(b));
  return (
    <Page
      back="/lojas"
      title={s.name}
      actions={
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          aria-label="abrir a loja"
        >
          <ExternalLink />
          <span className="max-md:hidden">abrir loja</span>
        </a>
      }
    >
      <div className="flex flex-col gap-3 md:gap-4">
        <Header d={d} />
        <Kpis d={d} />
        <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="flex min-w-0 flex-col gap-3 md:gap-4">
            <Charts d={d} />
            <InvoicesPanel d={d} />
            <UsersPanel d={d} />
            <StoreTimeline id={s.id} />
          </div>
          <div className={cn('flex min-w-0 flex-col gap-3 md:gap-4', toDo && 'max-lg:order-first')}>
            <BillingPanel b={billing} />
            <AiPanel d={d} />
            <ChannelsPanel d={d} />
          </div>
        </div>
      </div>
    </Page>
  );
}
