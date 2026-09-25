import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page } from '@/components/Page.tsx';
import { isActive } from '../activity/queries.ts';
import { AGENT_TABS } from '../tabs.ts';
import { Briefs } from './Briefs.tsx';
import { HuntForm } from './HuntForm.tsx';
import { LiveStage } from './LiveStage.tsx';
import { useDiscoveryRuns, useSegments } from './queries.ts';
import { RecentHunts } from './RecentHunts.tsx';
import { FoundLeads, SegmentBoard } from './Scoreboard.tsx';

/** Descoberta — hunt brief + daily rotation + scoreboard; ?run=<id> opens that run's live stage. */
export default function DiscoveryPage() {
  const [params, setParams] = useSearchParams();
  const runId = params.get('run');
  const [target, setTarget] = useState(5);
  const runs = useDiscoveryRuns();
  const segs = useSegments();
  const liveRun = runs.data?.find((r) => isActive(r.status));

  const watch = (id: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('run', id);
      return n;
    });
  const reset = () =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete('run');
      return n;
    });

  return (
    <Page title="Agente" tabs={AGENT_TABS}>
      <div className="flex flex-col gap-3">
        {runId ? (
          <LiveStage key={runId} runId={runId} fallbackTarget={target} onReset={reset} />
        ) : (
          <HuntForm
            segments={segs.data ?? []}
            liveRun={liveRun}
            target={target}
            onTarget={setTarget}
            onLaunched={watch}
            onWatch={watch}
          />
        )}
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <RecentHunts selected={runId} onOpen={watch} />
          <Briefs />
        </div>
        <SegmentBoard />
        <FoundLeads />
      </div>
    </Page>
  );
}
