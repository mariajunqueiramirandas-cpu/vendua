import { ErrorState, LoadingRows } from '@/components/common.tsx';
import { SectionHead } from './bits.tsx';
import { ConnectionPanel } from './telegram/ConnectionPanel.tsx';
import { EventsPanel } from './telegram/EventsPanel.tsx';
import { HealthPanel } from './telegram/HealthPanel.tsx';
import { useTelegram } from './telegram/queries.ts';

/** The team's Telegram bot (ADR 0047): 1-tap DM connection, event loudness, and health. */
export function TelegramArea({ onGoTeam }: { onGoTeam: () => void }) {
  const q = useTelegram();
  return (
    <section className="flex max-w-4xl flex-col gap-3">
      <SectionHead
        title="telegram"
        sub="receba alertas na DM, responda cartões ou mande texto e áudio para orientar e gerenciar o agente de vendas — com tudo sincronizado entre a equipe"
      />
      {q.isPending ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <ConnectionPanel d={q.data} />
          <EventsPanel d={q.data} />
          <HealthPanel d={q.data} onGoTeam={onGoTeam} />
        </>
      )}
    </section>
  );
}
