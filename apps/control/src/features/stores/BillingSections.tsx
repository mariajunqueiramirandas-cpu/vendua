import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import type { BillingStore, SiteRequestStatus } from '@/lib/api.ts';
import { fmtDate, fmtDay, fmtMoney } from '@/lib/format.ts';
import { Fact } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/controls.tsx';
import { Field, Select, Textarea } from '@/components/ui/input.tsx';
import {
  DOMAIN_STATUS,
  METHOD_LABEL,
  MP_STATUS,
  ORDER_STATUS,
  SheetSection,
  SITE_STATUS,
  SITE_STATUSES,
  SUB_STATUS,
  Tag,
} from './bits.tsx';
import {
  useActivateDomain,
  useMarkInvoicePaid,
  usePatchSiteRequest,
  useRetryDomainOrder,
} from './queries.ts';

const NOTE_MAX = 500;

function Billing({ s }: { s: BillingStore }) {
  const sub = s.subscription;
  return (
    <SheetSection title="assinatura">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="plano">{s.plan.name}</Fact>
        <Fact label="status">
          {sub ? <Tag map={SUB_STATUS} value={sub.status} /> : 'sem assinatura'}
        </Fact>
        <Fact label="forma de pagamento">
          {sub ? (METHOD_LABEL[sub.method] ?? sub.method) : '—'}
        </Fact>
        {sub?.status === 'trialing' ? (
          <Fact label="teste grátis até">
            <span className="tnum">{fmtDay(sub.trialEndsAt ?? sub.currentPeriodEnd)}</span>
          </Fact>
        ) : (
          <Fact label="próxima cobrança">
            <span className="tnum">
              {sub && sub.status !== 'cancelled' ? fmtDay(sub.currentPeriodEnd) : '—'}
            </span>
          </Fact>
        )}
        <Fact label="mercado pago da loja">
          <Tag map={MP_STATUS} value={s.mercadoPago} empty="não conectado" />
        </Fact>
        <Fact label="criada">{fmtDate(s.createdAt)}</Fact>
      </div>
      {s.openInvoice ? <OpenInvoice s={s} inv={s.openInvoice} /> : null}
    </SheetSection>
  );
}

/** Payment received outside Mercado Pago (access-code signups, a transfer): settle it by hand. */
function OpenInvoice({
  s,
  inv,
}: {
  s: BillingStore;
  inv: NonNullable<BillingStore['openInvoice']>;
}) {
  const [received, setReceived] = useState(false);
  const mark = useMarkInvoicePaid();
  useEffect(() => setReceived(false), [inv.id]);
  const sub = s.subscription;
  const first = sub?.status === 'pending';
  const trial = sub?.status === 'trialing';
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">
          fatura {inv.number}
          {inv.kind === 'upgrade' ? ' · troca de plano' : ''}
        </p>
        <p className="tnum text-sm font-semibold">{fmtMoney(inv.amountCents)}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        {first
          ? 'A loja está fechada até o primeiro pagamento. Confirmar abre a loja e inicia o mês do plano.'
          : trial
            ? `Confirmar dá como pago o primeiro mês, que começa quando o teste acaba (${fmtDay(sub.trialEndsAt ?? sub.currentPeriodEnd)}).`
            : `Confirmar dá o mês seguinte como pago. Em aberto desde ${fmtDay(inv.dueAt)}`}
      </p>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <Checkbox
          checked={received}
          onCheckedChange={(v) => setReceived(v === true)}
          className="mt-0.5"
        />
        <span>
          recebi <span className="tnum font-medium">{fmtMoney(inv.amountCents)}</span> de{' '}
          <span className="font-medium">{s.name}</span>
        </span>
      </label>
      <Button
        className="self-start max-md:w-full"
        disabled={!received || mark.isPending}
        onClick={() => mark.mutate(inv.id)}
      >
        {mark.isPending ? 'confirmando…' : 'marcar como pago'}
      </Button>
    </div>
  );
}

const SOURCE_LABEL = { included: 'incluso no plano', connected: 'do lojista' } as const;
const METHOD_META = { ns: 'servidores Venduá', cname: 'registros no provedor' } as const;

function Domain({ s }: { s: BillingStore }) {
  const d = s.customDomain;
  const o = s.domainOrder;
  const [certOk, setCertOk] = useState(false);
  const activate = useActivateDomain();
  useEffect(() => setCertOk(false), [d?.id]);

  if (!d && !o) {
    return (
      <SheetSection title="domínio próprio">
        <p className="text-sm text-muted-foreground">nenhum domínio cadastrado</p>
      </SheetSection>
    );
  }
  return (
    <SheetSection
      title="domínio próprio"
      aside={d ? <Tag map={DOMAIN_STATUS} value={d.status} /> : null}
    >
      {d && (
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            {d.status === 'active' ? (
              <a
                href={`https://${d.host}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate font-medium hover:underline"
              >
                {d.host}
              </a>
            ) : (
              <span className="min-w-0 truncate font-medium">{d.host}</span>
            )}
          </div>
          <p className="pl-6 text-xs text-muted-foreground">
            {[SOURCE_LABEL[d.source], METHOD_META[d.method]].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}

      {d?.status === 'dns_ok' && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-card">
          <p className="text-sm">
            o certificado é emitido sozinho em alguns minutos; ative à mão só se travar
          </p>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <Checkbox
              checked={certOk}
              onCheckedChange={(v) => setCertOk(v === true)}
              className="mt-0.5"
            />
            <span className="min-w-0 break-words">
              <span className="font-medium">https://{d.host}</span> já abre com certificado válido
            </span>
          </label>
          <Button
            className="self-start max-md:w-full"
            disabled={!certOk || activate.isPending}
            onClick={() => activate.mutate(d.id)}
          >
            {activate.isPending ? 'ativando…' : 'ativar domínio'}
          </Button>
        </div>
      )}
      {d?.status === 'pending_dns' && (
        <p className="text-xs text-muted-foreground">
          o DNS do lojista ainda não foi confirmado — nada a fazer aqui por enquanto
        </p>
      )}
      {d?.status === 'repairing' && (
        <p className="text-xs text-destructive-foreground">
          o domínio parou de apontar para a Venduá — a loja segue no endereço Venduá; o lojista foi
          avisado
        </p>
      )}
      {d?.status === 'lapsed' && (
        <p className="text-xs text-muted-foreground">
          o plano perdeu o domínio próprio; o endereço redireciona para o da Venduá
        </p>
      )}
      {d?.status === 'failed' && (
        <p className="text-xs text-destructive-foreground">
          a verificação de DNS falhou — o lojista precisa conferir os registros no painel dele
        </p>
      )}
      {o && <DomainOrder o={o} />}
    </SheetSection>
  );
}

/** The registrar order behind an included domain; conflict/failed go back to the queue by hand. */
function DomainOrder({ o }: { o: NonNullable<BillingStore['domainOrder']> }) {
  const retry = useRetryDomainOrder();
  const stuck = o.status === 'conflict' || o.status === 'failed';
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-card">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="shrink-0 text-xs text-muted-foreground">registro</span>
        <span className="min-w-0 truncate font-medium">{o.host}</span>
        <Tag map={ORDER_STATUS} value={o.status} className="ml-auto shrink-0" />
      </div>
      {o.lastError && <p className="text-xs break-words text-muted-foreground">{o.lastError}</p>}
      {stuck && (
        <Button
          variant="outline"
          size="sm"
          className="self-start max-md:w-full"
          disabled={retry.isPending}
          onClick={() => retry.mutate(o.id)}
        >
          {retry.isPending ? 'reenviando…' : 'tentar de novo'}
        </Button>
      )}
    </div>
  );
}

function SiteRequest({ s }: { s: BillingStore }) {
  const r = s.siteRequest;
  const [status, setStatus] = useState<SiteRequestStatus>(r?.status ?? 'requested');
  const saved = r?.staffNote ?? '';
  const [note, setNote] = useState(saved);
  const patch = usePatchSiteRequest();
  useEffect(() => {
    setStatus(r?.status ?? 'requested');
    setNote(r?.staffNote ?? '');
  }, [r?.id, r?.status, r?.staffNote]);

  if (!r) {
    return (
      <SheetSection title="site sob medida">
        <p className="text-sm text-muted-foreground">nenhum pedido de site</p>
      </SheetSection>
    );
  }
  const noteChanged = note.trim() !== saved.trim() && note.trim() !== '';
  const dirty = status !== r.status || noteChanged;
  return (
    <SheetSection title="site sob medida" aside={<Tag map={SITE_STATUS} value={r.status} />}>
      <Field label="o que o lojista pediu">
        <div className="max-h-48 overflow-auto rounded-md border bg-muted/60 px-2.5 py-2 text-sm whitespace-pre-wrap">
          {r.brief?.trim() || <span className="text-muted-foreground">sem descrição</span>}
        </div>
      </Field>
      <form
        className="flex flex-col gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!dirty) return;
          patch.mutate({ id: r.id, status, ...(noteChanged ? { staffNote: note.trim() } : {}) });
        }}
      >
        <Field label="status" htmlFor="site-status">
          <Select
            id="site-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as SiteRequestStatus)}
          >
            {SITE_STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="nota da equipe"
          htmlFor="site-note"
          hint={
            <span className="flex justify-between gap-2">
              <span>opcional</span>
              <span className="tnum">
                {note.length}/{NOTE_MAX}
              </span>
            </span>
          }
        >
          <Textarea
            id="site-note"
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ex.: primeira versão no ar para revisão"
          />
        </Field>
        <Button
          type="submit"
          className="self-end max-md:w-full"
          disabled={!dirty || patch.isPending}
        >
          {patch.isPending ? 'salvando…' : 'salvar pedido'}
        </Button>
      </form>
    </SheetSection>
  );
}

/** Subscription, custom domain and site request of one store, with the staff actions on each. */
export function BillingSections({ store }: { store: BillingStore }) {
  return (
    <div className="flex flex-col gap-4">
      <Billing s={store} />
      <Domain s={store} />
      <SiteRequest s={store} />
    </div>
  );
}
