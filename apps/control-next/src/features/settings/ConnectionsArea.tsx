import type { Integration } from '@/lib/api.ts';
import { Skeleton } from '@/components/ui/controls.tsx';
import { SectionHead } from './bits.tsx';
import { KINDS, WA_IDLE, type WaState } from './providers.ts';
import { ProviderCard } from './ProviderCard.tsx';
import { useSaveIntegration, useWaLogout } from './queries.ts';

export function ConnectionsArea({
  integrations,
  loading,
  wa,
  provLive,
}: {
  integrations: Integration[];
  loading: boolean;
  wa: WaState;
  provLive: number;
}) {
  const save = useSaveIntegration();
  const logout = useWaLogout();
  return (
    <section>
      <SectionHead
        title="provedores"
        sub={`um driver ativo por tipo — ${provLive}/${KINDS.length} prontos`}
      />
      <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        {loading && !integrations.length
          ? KINDS.map((k) => <Skeleton key={k.key} className="h-56 rounded-lg" />)
          : KINDS.map((k) => (
              <div key={k.key} id={`prov-${k.key}`} className="flex scroll-mt-3 flex-col">
                <ProviderCard
                  kind={k}
                  rows={integrations.filter((i) => i.kind === k.key)}
                  wa={k.key === 'whatsapp' ? wa : WA_IDLE}
                  onWaLogout={k.key === 'whatsapp' ? () => logout.mutate() : undefined}
                  waLoggingOut={logout.isPending}
                  saving={save.isPending && save.variables.kind === k.key}
                  onSave={(d, enable) => save.mutate({ kind: k.key, d, enable })}
                />
              </div>
            ))}
      </div>
    </section>
  );
}
