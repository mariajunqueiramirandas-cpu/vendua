import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SearchX, Store, Undo2 } from 'lucide-react';
import type { FleetStatus, FleetStorefront, FleetStorefrontDetail } from '@/lib/api.ts';
import { EmptyState, Fact, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Input, Label, Select } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { SheetSection } from '@/features/stores/bits.tsx';
import { ago, HostLink, Mono, ProbeChip, short } from './bits.tsx';
import { Policy } from './FleetList.tsx';
import { useFleetStorefront, usePatchStorefront, useRollback } from './queries.ts';
import {
  DeploymentsSection,
  ProbeSection,
  ProvisioningSection,
  ReleasesSection,
  StoreAlertsSection,
} from './SheetSections.tsx';

type Draft = null | 'pin' | 'auto' | 'rollback' | 'bundle';

/** Inline confirm panel: an optional reason and the action — no modal on top of the sheet. */
function Confirm({
  text,
  reason,
  onReason,
  reasonLabel = 'motivo (opcional)',
  action,
  busy,
  onConfirm,
  onCancel,
  destructive,
}: {
  text: ReactNode;
  reason?: string | undefined;
  onReason?: ((v: string) => void) | undefined;
  reasonLabel?: string | undefined;
  action: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean | undefined;
}) {
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm();
      }}
    >
      <p className="text-[13px]">{text}</p>
      {onReason && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="fleet-reason">{reasonLabel}</Label>
          <Input
            id="fleet-reason"
            autoFocus
            maxLength={300}
            value={reason ?? ''}
            onChange={(e) => onReason(e.target.value)}
          />
        </div>
      )}
      <div className="flex gap-2 max-md:[&>*]:flex-1">
        <Button
          type="submit"
          size="sm"
          variant={destructive ? 'destructive' : 'default'}
          disabled={busy}
        >
          {busy ? 'salvando…' : action}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          cancelar
        </Button>
      </div>
    </form>
  );
}

function LiveSection({
  s,
  bundles,
}: {
  s: FleetStorefrontDetail;
  bundles: FleetStatus['bundles'];
}) {
  const [draft, setDraft] = useState<Draft>(null);
  const [reason, setReason] = useState('');
  const [bundle, setBundle] = useState(s.bundle);
  const patch = usePatchStorefront(s.slug);
  const rollback = useRollback(s.slug);
  useEffect(() => {
    setDraft(null);
    setReason('');
    setBundle(s.bundle);
  }, [s.slug, s.bundle, s.policy, s.live?.release]);

  // same pick as Core's rollback: the newest other release that went live here
  const previous =
    s.deployments.find((d) => d.status === 'live' && d.release !== s.live?.release)?.release ??
    null;
  const choices = bundles.filter((b) => b.latestRelease || b.bundle === s.bundle);
  const done = { onSuccess: () => setDraft(null) };
  const r = reason.trim() ? { reason: reason.trim() } : {};

  return (
    <SheetSection title="versão no ar">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="versão">
          {s.live ? <Mono>{short(s.live.release)}</Mono> : 'nada no ar'}
          {s.behind && (
            <Badge
              variant="warn"
              className="ml-1.5"
              title={`a mais nova é ${short(s.latestRelease)}`}
            >
              atrás
            </Badge>
          )}
        </Fact>
        <Fact label="kernel">
          <span className="tnum">{s.live?.kernelVersion ?? '—'}</span>
        </Fact>
        <Fact label="no ar desde">
          <span className="tnum">{ago(s.live?.since)}</span>
        </Fact>
        <Fact label="pacote">
          <Mono>{s.bundle}</Mono>
        </Fact>
      </div>

      <div className="flex items-start gap-2.5 pt-1">
        <Switch
          id="fleet-policy"
          checked={s.policy === 'auto'}
          disabled={patch.isPending}
          onCheckedChange={(on) => setDraft(on ? 'auto' : 'pin')}
        />
        <Label htmlFor="fleet-policy" className="flex min-w-0 flex-col text-sm">
          <span className="text-foreground">seguir o pacote</span>
          <span className="text-xs font-normal text-muted-foreground">
            {s.policy === 'auto'
              ? 'cada versão nova aprovada do pacote entra sozinha'
              : `fixada — ${s.pinnedReason ?? 'sem motivo'}`}
          </span>
        </Label>
      </div>
      {draft === 'pin' && (
        <Confirm
          text="a loja fica nesta versão até alguém soltar."
          reason={reason}
          onReason={setReason}
          reasonLabel="por que fixar?"
          action="fixar"
          busy={patch.isPending}
          onConfirm={() => patch.mutate({ policy: 'pinned', ...r }, done)}
          onCancel={() => setDraft(null)}
        />
      )}
      {draft === 'auto' && (
        <Confirm
          text={
            s.behind
              ? `a versão ${short(s.latestRelease)} do pacote entra agora.`
              : 'a loja volta a receber as versões novas do pacote.'
          }
          action="seguir o pacote"
          busy={patch.isPending}
          onConfirm={() => patch.mutate({ policy: 'auto' }, done)}
          onCancel={() => setDraft(null)}
        />
      )}

      <div className="flex flex-col gap-2 pt-1 md:flex-row md:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor="fleet-bundle">pacote</Label>
          <Select
            id="fleet-bundle"
            value={bundle}
            onChange={(e) => {
              setBundle(e.target.value);
              setDraft(e.target.value === s.bundle ? null : 'bundle');
            }}
          >
            {choices.map((b) => (
              <option key={b.bundle} value={b.bundle}>
                {b.bundle}
                {b.stores ? ` · ${b.stores} ${b.stores === 1 ? 'loja' : 'lojas'}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="outline"
          disabled={!previous || rollback.isPending}
          title={previous ? undefined : 'não há versão anterior registrada'}
          onClick={() => setDraft('rollback')}
        >
          <Undo2 /> voltar para a anterior
          {previous && <Mono className="text-muted-foreground">{short(previous)}</Mono>}
        </Button>
      </div>
      {draft === 'bundle' && (
        <Confirm
          text={
            <>
              trocar para <Mono>{bundle}</Mono>? a versão mais nova dele entra agora, com o layout e
              as cores salvos para ele (os deste pacote ficam guardados), e a loja passa a seguir
              esse pacote.
            </>
          }
          action="trocar pacote"
          busy={patch.isPending}
          onConfirm={() => patch.mutate({ bundle }, done)}
          onCancel={() => {
            setBundle(s.bundle);
            setDraft(null);
          }}
        />
      )}
      {draft === 'rollback' && previous && (
        <Confirm
          text={
            <>
              a loja volta para <Mono>{short(previous)}</Mono> agora e fica fixada nela.
            </>
          }
          reason={reason}
          onReason={setReason}
          action="voltar agora"
          destructive
          busy={rollback.isPending}
          onConfirm={() => rollback.mutate(r, done)}
          onCancel={() => setDraft(null)}
        />
      )}
    </SheetSection>
  );
}

export function FleetSheet({
  slug,
  row,
  bundles,
  onClose,
}: {
  slug: string | null;
  /** the list row, so the header shows before the detail lands */
  row: FleetStorefront | null;
  bundles: FleetStatus['bundles'];
  onClose: () => void;
}) {
  const q = useFleetStorefront(slug);
  const s = q.data ?? null;
  const head = s ?? row;
  return (
    <ResponsiveSheet
      open={!!slug}
      onOpenChange={(o) => !o && onClose()}
      title={head?.name ?? (q.isPending ? 'carregando…' : 'loja')}
      description={
        head ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <HostLink host={head.host} className="max-w-full" />
            <ProbeChip status={head.probe?.status} />
            <Policy s={head} />
            {head.maintenance && <Badge variant="warn">manutenção</Badge>}
            {head.status !== 'active' && <Badge variant="outline">{head.status}</Badge>}
            <Link
              to={`/lojas/${head.tenantId}`}
              className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline pointer-coarse:min-h-9"
            >
              <Store className="size-3.5" /> página da loja
            </Link>
          </span>
        ) : undefined
      }
      width="max-w-xl"
    >
      {s ? (
        <div className="flex flex-col gap-4 pt-1">
          <LiveSection s={s} bundles={bundles} />
          <ReleasesSection s={s} />
          <ProbeSection s={s} />
          <DeploymentsSection s={s} />
          {s.provisioningDetail && <ProvisioningSection p={s.provisioningDetail} />}
          <StoreAlertsSection s={s} />
        </div>
      ) : q.isPending && slug ? (
        <LoadingRows rows={6} />
      ) : (
        <EmptyState icon={SearchX} title="loja não encontrada" hint="confira o endereço" />
      )}
    </ResponsiveSheet>
  );
}
