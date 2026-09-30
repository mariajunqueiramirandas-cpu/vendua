import { useEffect, useState } from 'react';
import { Globe, SearchX } from 'lucide-react';
import type { BillingStore, SiteRequestStatus } from '@/lib/api.ts';
import { fmtDate, fmtDay } from '@/lib/format.ts';
import { EmptyState, Fact, LoadingRows } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/controls.tsx';
import { Field, Select, Textarea } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import {
  DOMAIN_STATUS,
  METHOD_LABEL,
  MP_STATUS,
  SheetSection,
  SITE_STATUS,
  SITE_STATUSES,
  StoreLink,
  SUB_STATUS,
  Tag,
} from './bits.tsx';
import { useActivateDomain, usePatchSiteRequest } from './queries.ts';

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
        <Fact label="próxima cobrança">
          <span className="tnum">
            {sub && sub.status !== 'cancelled' ? fmtDay(sub.currentPeriodEnd) : '—'}
          </span>
        </Fact>
        <Fact label="mercado pago da loja">
          <Tag map={MP_STATUS} value={s.mercadoPago} empty="não conectado" />
        </Fact>
        <Fact label="criada">{fmtDate(s.createdAt)}</Fact>
      </div>
    </SheetSection>
  );
}

function Domain({ s }: { s: BillingStore }) {
  const d = s.customDomain;
  const [certOk, setCertOk] = useState(false);
  const activate = useActivateDomain();
  useEffect(() => setCertOk(false), [d?.id]);

  if (!d) {
    return (
      <SheetSection title="domínio próprio">
        <p className="text-sm text-muted-foreground">nenhum domínio cadastrado</p>
      </SheetSection>
    );
  }
  return (
    <SheetSection title="domínio próprio" aside={<Tag map={DOMAIN_STATUS} value={d.status} />}>
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

      {d.status === 'dns_ok' && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-card">
          <p className="text-sm">
            Adicione o domínio no Dokploy/Traefik com certificado, depois ative aqui.
          </p>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <Checkbox
              checked={certOk}
              onCheckedChange={(v) => setCertOk(v === true)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{d.host}</span> já está no Traefik com certificado
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
      {d.status === 'pending_dns' && (
        <p className="text-xs text-muted-foreground">
          o DNS do lojista ainda não foi confirmado — nada a fazer aqui por enquanto
        </p>
      )}
      {d.status === 'failed' && (
        <p className="text-xs text-destructive-foreground">
          a verificação de DNS falhou — o lojista precisa conferir os registros no painel dele
        </p>
      )}
    </SheetSection>
  );
}

function SiteRequest({ s }: { s: BillingStore }) {
  const r = s.siteRequest;
  const [status, setStatus] = useState<SiteRequestStatus>(r?.status ?? 'requested');
  const [note, setNote] = useState('');
  const patch = usePatchSiteRequest();
  useEffect(() => {
    setStatus(r?.status ?? 'requested');
    setNote('');
  }, [r?.id, r?.status]);

  if (!r) {
    return (
      <SheetSection title="site sob medida">
        <p className="text-sm text-muted-foreground">nenhum pedido de site</p>
      </SheetSection>
    );
  }
  const dirty = status !== r.status || note.trim() !== '';
  return (
    <SheetSection title="site sob medida" aside={<Tag map={SITE_STATUS} value={r.status} />}>
      <Field label="o que o lojista pediu">
        <div className="max-h-48 overflow-auto rounded-md bg-muted px-2.5 py-2 text-sm whitespace-pre-wrap">
          {r.brief?.trim() || <span className="text-muted-foreground">sem descrição</span>}
        </div>
      </Field>
      <form
        className="flex flex-col gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!dirty) return;
          patch.mutate(
            { id: r.id, status, staffNote: note.trim() },
            { onSuccess: () => setNote('') },
          );
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

export function StoreSheet({
  store,
  open,
  loading,
  onClose,
}: {
  store: BillingStore | null;
  open: boolean;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={store?.name ?? (loading ? 'carregando…' : 'loja')}
      description={store ? <StoreLink store={store} /> : undefined}
      width="max-w-lg"
    >
      {store ? (
        <div className="flex flex-col gap-4 pt-1">
          <Billing s={store} />
          <Domain s={store} />
          <SiteRequest s={store} />
        </div>
      ) : loading ? (
        <LoadingRows rows={5} />
      ) : (
        <EmptyState icon={SearchX} title="loja não encontrada" hint="ela pode ter saído da lista" />
      )}
    </ResponsiveSheet>
  );
}
