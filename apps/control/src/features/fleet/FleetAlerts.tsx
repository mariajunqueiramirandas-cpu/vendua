import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, RotateCw } from 'lucide-react';
import type { FleetIncident, Provisioning } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { ago, ProvisionProgress, SEVERITY, SeverityDot, SOURCE_LABEL, ToneTag } from './bits.tsx';
import { usePatchFleetIncident, useRetryProvisioning } from './queries.ts';

/** Heading for the blocks above the list — same voice as the sheet sections. */
function BlockHead({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
      <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <span className="text-[11px] text-muted-foreground tnum">{count}</span>
    </div>
  );
}

/** One open incident: severity, summary, store link, age, ack/resolve. Acked rows go quiet. */
export function AlertRow({
  i,
  storeHref,
  className,
}: {
  i: FleetIncident;
  /** link that opens the store's sheet — omit inside the sheet itself */
  storeHref?: string | undefined;
  className?: string | undefined;
}) {
  const patch = usePatchFleetIncident();
  const busy = patch.isPending && patch.variables?.id === i.id;
  const acked = !!i.ackedAt;
  const resolved = !!i.resolvedAt;
  return (
    <li
      className={cn(
        'flex flex-col gap-1.5 px-3 py-2 md:flex-row md:items-center md:gap-3',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2 md:items-center">
        <span className="mt-1.5 md:mt-0">
          <SeverityDot severity={i.severity} quiet={acked || resolved} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-center md:gap-2">
          <span className="flex shrink-0 items-center gap-1.5">
            <ToneTag
              map={SEVERITY}
              value={i.severity}
              className={cn((acked || resolved) && 'opacity-60')}
            />
            {acked && !resolved && <span className="text-[11px] text-muted-foreground">visto</span>}
          </span>
          <span
            className={cn(
              'min-w-0 text-[13px] md:truncate',
              acked || resolved ? 'text-muted-foreground' : 'font-medium',
            )}
          >
            {i.summary}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-4 text-xs text-muted-foreground md:pl-0">
        {storeHref && i.tenant && (
          <Link to={storeHref} className="max-w-40 truncate hover:text-foreground hover:underline">
            {i.tenant}
          </Link>
        )}
        <span className="tnum whitespace-nowrap">
          {resolved ? `resolvido ${ago(i.resolvedAt)}` : ago(i.openedAt)}
        </span>
        {!resolved && (
          <span className="ml-auto flex gap-1 md:ml-2">
            {!acked && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => patch.mutate({ id: i.id, op: 'ack' })}
              >
                reconhecer
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => patch.mutate({ id: i.id, op: 'resolve' })}
            >
              <Check /> resolver
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

const ALERTS_SHOWN = 3;

export function FleetAlerts({
  incidents,
  hrefFor,
}: {
  incidents: FleetIncident[];
  hrefFor: (slug: string) => string;
}) {
  const [all, setAll] = useState(false);
  if (!incidents.length) return null;
  // Core orders critical first, then newest — the cap keeps what matters on top
  const shown = all ? incidents : incidents.slice(0, ALERTS_SHOWN);
  const more = incidents.length - shown.length;
  return (
    <Card className="-mx-3 overflow-hidden rounded-none border-x-0 md:mx-0 md:rounded-lg md:border-x">
      <BlockHead title="alertas" count={incidents.length} />
      <ul className="divide-y border-t">
        {shown.map((i) => (
          <AlertRow key={i.id} i={i} storeHref={i.tenant ? hrefFor(i.tenant) : undefined} />
        ))}
      </ul>
      {(more > 0 || all) && incidents.length > ALERTS_SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="flex h-9 w-full items-center justify-center gap-1 border-t text-xs font-medium text-muted-foreground hover:bg-hover hover:text-foreground pointer-coarse:h-11"
        >
          {all ? 'mostrar menos' : `mais ${more} ${more === 1 ? 'alerta' : 'alertas'}`}
          <ChevronDown className={cn('size-3.5 transition-transform', all && 'rotate-180')} />
        </button>
      )}
    </Card>
  );
}

/** Retry + attempts for a provisioning that isn't live — shared by the page, sheet and lead card. */
export function RetryButton({ p }: { p: Provisioning }) {
  const retry = useRetryProvisioning();
  if (p.state === 'live') return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={retry.isPending}
      onClick={() => retry.mutate(p.id)}
    >
      <RotateCw /> {retry.isPending ? 'tentando…' : 'tentar de novo'}
    </Button>
  );
}

function ProvisionRow({ p, href }: { p: Provisioning; href: string | undefined }) {
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 md:grid md:grid-cols-[minmax(0,14rem)_minmax(0,18rem)_minmax(0,1fr)_auto] md:items-center md:gap-4">
      <div className="flex min-w-0 items-baseline gap-2">
        {href ? (
          <Link to={href} className="truncate text-[13px] font-medium hover:underline">
            {p.storeName ?? p.tenant}
          </Link>
        ) : (
          <span className="truncate text-[13px] font-medium">{p.storeName ?? p.tenant}</span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {SOURCE_LABEL[p.source] ?? p.source}
        </span>
      </div>
      <ProvisionProgress state={p.state} error={!!p.lastError} />
      <div className="min-w-0 text-xs">
        {p.lastError ? (
          <p className="line-clamp-2 text-warning-foreground">{p.lastError}</p>
        ) : (
          <p className="text-muted-foreground">em andamento · {ago(p.createdAt)}</p>
        )}
        {p.attempts > 0 && (
          <p className="text-muted-foreground tnum">
            {p.attempts} {p.attempts === 1 ? 'tentativa' : 'tentativas'}
          </p>
        )}
      </div>
      <div className="flex justify-end">
        <RetryButton p={p} />
      </div>
    </li>
  );
}

export function FleetProvisioning({
  items,
  hrefFor,
}: {
  items: Provisioning[];
  hrefFor: (slug: string) => string;
}) {
  if (!items.length) return null;
  return (
    <Card className="-mx-3 overflow-hidden rounded-none border-x-0 md:mx-0 md:rounded-lg md:border-x">
      <BlockHead title="provisionando" count={items.length} />
      <ul className="divide-y border-t">
        {items.map((p) => (
          <ProvisionRow key={p.id} p={p} href={p.tenant ? hrefFor(p.tenant) : undefined} />
        ))}
      </ul>
    </Card>
  );
}
