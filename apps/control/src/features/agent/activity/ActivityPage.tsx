import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Page } from '@/components/Page.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Select } from '@/components/ui/input.tsx';
import { useIsDesktop, useIsMobile } from '@/lib/hooks.ts';
import { RUN_KIND_LABEL } from '@/lib/labels.ts';
import { AGENT_TABS } from '../tabs.ts';
import { ByKindTable, MetricsStrip } from './Metrics.tsx';
import { RUN_VIEWS, runListParams } from './queries.ts';
import { RunDetail } from './RunDetail.tsx';
import { RunList } from './RunList.tsx';

const KINDS = Object.entries(RUN_KIND_LABEL);
const DAYS = [
  ['7', '7d'],
  ['30', '30d'],
] as const;

export default function ActivityPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const desktop = useIsDesktop();
  const mobile = useIsMobile();

  const kind = sp.get('kind') ?? '';
  const view = sp.get('status') ?? '';
  const days: 7 | 30 = sp.get('d') === '30' ? 30 : 7;
  const qs = sp.toString() ? `?${sp}` : '';
  const listPath = `/agente/atividade${qs}`;
  const open = (rid: string) => nav(`/agente/atividade/${rid}${qs}`);
  const set = (k: string, v: string) =>
    setSp(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );

  const params = runListParams(kind, view);

  const toolbar = (
    <div className="flex items-center gap-2">
      {mobile ? (
        <Select
          value={view}
          onChange={(e) => set('status', e.target.value)}
          aria-label="status"
          className="flex-1"
        >
          {RUN_VIEWS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      ) : (
        <Segmented size="sm" value={view} onChange={(v) => set('status', v)} options={RUN_VIEWS} />
      )}
      <Select
        value={kind}
        onChange={(e) => set('kind', e.target.value)}
        aria-label="tipo"
        className={mobile ? 'flex-1' : 'w-40'}
      >
        <option value="">todos os tipos</option>
        {KINDS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </Select>
    </div>
  );

  const metrics = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">leitura</h2>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">
          cada run é auditado — prompt, ferramentas, tokens, custo
        </span>
        <Segmented
          size="sm"
          className="ml-auto"
          value={String(days) as '7' | '30'}
          onChange={(v) => set('d', v === '30' ? '30' : '')}
          options={DAYS}
        />
      </div>
      <MetricsStrip days={days} />
    </div>
  );

  // phones/tablets: list route → detail route
  if (!desktop && id)
    return (
      <Page title="Agente" tabs={AGENT_TABS} back={listPath}>
        <RunDetail id={id} />
      </Page>
    );

  if (!desktop)
    return (
      <Page title="Agente" tabs={AGENT_TABS} toolbar={toolbar}>
        <div className="flex flex-col gap-3">
          {metrics}
          <details className="group rounded-lg border bg-card">
            <summary className="flex h-9 cursor-pointer list-none items-center px-3 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
              por tipo de run
            </summary>
            <div className="border-t">
              <ByKindTable days={days} />
            </div>
          </details>
          <div className="-mx-3 border-y bg-card md:mx-0 md:rounded-lg md:border-x">
            <RunList params={params} view={view} onOpen={open} />
          </div>
        </div>
      </Page>
    );

  return (
    <Page title="Agente" tabs={AGENT_TABS} toolbar={toolbar} bleed>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[50%] max-w-[760px] min-w-[480px] shrink-0 flex-col overflow-auto border-r bg-card">
          <RunList params={params} view={view} selectedId={id} onOpen={open} narrow />
        </div>
        <div className="min-w-0 flex-1 overflow-auto p-4">
          {id ? (
            <RunDetail key={id} id={id} onClose={() => nav(listPath)} />
          ) : (
            <div className="flex flex-col gap-3">
              {metrics}
              <Panel title="por tipo de run" flush>
                <ByKindTable days={days} />
              </Panel>
              <p className="text-center text-xs text-muted-foreground">
                escolha um run à esquerda para ver a trajetória completa
              </p>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
