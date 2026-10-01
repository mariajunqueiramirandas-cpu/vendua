import { ErrorState, LoadingRows } from '@/components/common.tsx';
import { SectionHead } from './bits.tsx';
import { ChannelsPanel } from './discord/ChannelsPanel.tsx';
import { ConnectionPanel } from './discord/ConnectionPanel.tsx';
import { EventsPanel } from './discord/EventsPanel.tsx';
import { HealthPanel } from './discord/HealthPanel.tsx';
import { useDiscord } from './discord/queries.ts';

/** The team's bot (ADR 0023): connection, where things land, how loud, and whether it keeps up. */
export function DiscordArea({ onGoTeam }: { onGoTeam: () => void }) {
  const q = useDiscord();
  return (
    <section className="flex max-w-4xl flex-col gap-3">
      <SectionHead
        title="discord"
        sub="tudo o que acontece na Venduá chega no servidor da equipe — e rascunhos, handoffs e incidentes se resolvem por lá, com o nome de quem clicou"
      />
      {q.isPending ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <ConnectionPanel d={q.data} />
          <ChannelsPanel d={q.data} />
          <EventsPanel d={q.data} />
          <HealthPanel d={q.data} onGoTeam={onGoTeam} />
        </>
      )}
    </section>
  );
}
