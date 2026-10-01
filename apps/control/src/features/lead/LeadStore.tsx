import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Plus, Server } from 'lucide-react';
import type { Lead } from '@/lib/api.ts';
import { Button } from '@/components/ui/button.tsx';
import { ago, HostLink, ProvisionProgress, STORE_SUFFIX } from '@/features/fleet/bits.tsx';
import { CreateStoreSheet } from '@/features/fleet/CreateStoreSheet.tsx';
import { RetryButton } from '@/features/fleet/FleetAlerts.tsx';
import { useProvisionings } from '@/features/fleet/queries.ts';
import { LeadImport } from './LeadImport.tsx';
import { Hint, Section } from './Section.tsx';

/** The lead's store: its provisioning progress, or the way to create one. */
export function LeadStore({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const q = useProvisionings(lead.id);
  const p = q.data?.[0];

  if (q.isPending) return null;
  if (!p) {
    return (
      <Section title="loja">
        <div className="flex items-center gap-2">
          <Hint className="flex-1">ainda sem loja na Venduá</Hint>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus /> criar loja
          </Button>
        </div>
        <CreateStoreSheet lead={lead} open={open} onClose={() => setOpen(false)} />
      </Section>
    );
  }
  const host = p.host ?? (p.tenant ? `${p.tenant}${STORE_SUFFIX}` : null);
  return (
    <Section
      title="loja"
      aside={p.state === 'live' ? `no ar ${ago(p.liveAt)}` : `criada ${ago(p.createdAt)}`}
    >
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{p.storeName ?? p.tenant}</span>
          <HostLink host={host} className="max-w-full" />
        </div>
        <ProvisionProgress state={p.state} error={!!p.lastError} />
        {p.lastError && <p className="text-xs text-warning-foreground">{p.lastError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {p.tenant && (
            <Button size="sm" variant="ghost" asChild className="-ml-2">
              <Link to={`/lojas/frota?loja=${encodeURIComponent(p.tenant)}`}>
                <Server /> ver na frota
              </Link>
            </Button>
          )}
          {p.tenant && (
            <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setImporting(true)}>
              <Download /> importar cardápio
            </Button>
          )}
          <span className="ml-auto">
            <RetryButton p={p} />
          </span>
        </div>
        {p.tenant && (
          <LeadImport
            lead={lead}
            slug={p.tenant}
            open={importing}
            onClose={() => setImporting(false)}
          />
        )}
      </div>
    </Section>
  );
}
