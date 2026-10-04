import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { AiModelsView } from '@/lib/api.ts';
import { ApiError } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { errorMessage } from '@/lib/query.ts';
import { Page } from '@/components/Page.tsx';
import { ErrorState, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import {
  budgetKeys,
  budgetPaths,
  budgetsFromView,
  budgetsOut,
  cleanMessage,
  resolveField,
  routePaths,
  routesFromView,
  routesOut,
  validateBudgets,
  validateRoutes,
  type BudgetsDraft,
  type Errors,
  type RoutesDraft,
} from './draft.ts';
import { ErrorsCtx, FieldMsg, HintPanel, Notice, type Ns } from './bits.tsx';
import { BudgetsPanel } from './BudgetsPanel.tsx';
import { providerLabel } from './format.ts';
import { AgentOverrides, StoreOverrides } from './Overrides.tsx';
import { useAiModels, useSaveAiSetting, type AiSettingKey } from './queries.ts';
import { TiersEditor, type KeyStatus } from './RouteEditor.tsx';
import { AI_TABS } from './tabs.ts';

/**
 * A local copy of a server value. A refetch replaces it only while it's unedited, so the
 * 60 s poll never eats someone's changes; `dirty` compares the serialized forms.
 */
function useSyncedDraft<S, D>(src: S | undefined, toDraft: (s: S) => D, out: (d: D) => unknown) {
  const [draft, setDraft] = useState<D | null>(null);
  const base = useRef<string | null>(null);
  const [, bump] = useState(0);
  const canon = (d: D) => JSON.stringify(out(d));
  useEffect(() => {
    if (src === undefined) return;
    const next = toDraft(src);
    const prev = base.current;
    setDraft((d) => (d === null || canon(d) === prev ? next : d));
    base.current = canon(next);
    bump((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  return {
    draft,
    setDraft: (d: D) => setDraft(d),
    dirty: draft !== null && base.current !== null && canon(draft) !== base.current,
    discard: () => src !== undefined && setDraft(toDraft(src)),
    markSaved: (d: D) => {
      base.current = canon(d);
      bump((n) => n + 1);
    },
  };
}

const SOURCE: Record<
  AiModelsView['routesSource'],
  { label: string; variant: 'solid' | 'default' | 'bad' }
> = {
  settings: { label: 'Config', variant: 'solid' },
  env: { label: 'variável de ambiente', variant: 'default' },
  none: { label: 'não configurado', variant: 'bad' },
};

function StatusPanel({ view }: { view: AiModelsView }) {
  const src = SOURCE[view.routesSource];
  return (
    <Panel title="situação">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>rotas vêm de</span>
          <Badge variant={src.variant}>{src.label}</Badge>
        </div>
        {view.routesSource === 'none' && (
          <Notice tone="bad">
            Nenhuma rota configurada: o Duá não responde até haver uma rota. Adicione uma rota
            rápida no padrão e salve.
          </Notice>
        )}
        {view.routesSource === 'env' && (
          <p className="text-xs text-muted-foreground">
            As rotas abaixo vêm da variável AGENT_MODEL_ROUTES do servidor. Ao salvar aqui, a Config
            passa a valer no lugar dela.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground/80">chaves dos provedores</span>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {view.providers.map((p) => (
              <li key={p.id} className="flex min-w-0 items-center gap-2 text-[13px]">
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    p.configured ? 'bg-success' : 'bg-border-strong',
                  )}
                />
                <span className="font-medium">{providerLabel(p.id)}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {p.configured ? 'chave presente' : `sem chave (${p.secretName})`}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">
          Toda rota precisa de retenção zero: o provedor não guarda nada do que o Duá envia. Depois
          de salvar, as mudanças valem em até um minuto.
        </p>
      </div>
    </Panel>
  );
}

type FieldErrors = Record<Ns, Errors>;
const NO_ERRORS: FieldErrors = { routes: {}, budgets: {} };

export default function ModelsPage() {
  const query = useAiModels();
  const view = query.data;
  const routes = useSyncedDraft(view?.routes, routesFromView, routesOut);
  const budgets = useSyncedDraft(view?.budgets, budgetsFromView, budgetsOut);
  const save = useSaveAiSetting();
  const [tried, setTried] = useState(false);
  const [server, setServer] = useState<FieldErrors>(NO_ERRORS);
  const [general, setGeneral] = useState<string | null>(null);

  const keys = useMemo<KeyStatus>(
    () => Object.fromEntries((view?.providers ?? []).map((p) => [p.id, p.configured])),
    [view?.providers],
  );
  const bKeys = useMemo(() => (view ? budgetKeys(view) : []), [view]);
  const client: FieldErrors = {
    routes: routes.draft ? validateRoutes(routes.draft) : {},
    budgets: budgets.draft ? validateBudgets(budgets.draft) : {},
  };
  const shown: FieldErrors = tried
    ? {
        routes: { ...client.routes, ...server.routes },
        budgets: { ...client.budgets, ...server.budgets },
      }
    : server;

  const edit = {
    routes: (d: RoutesDraft) => {
      routes.setDraft(d);
      setServer((s) => ({ ...s, routes: {} }));
      setGeneral(null);
    },
    budgets: (d: BudgetsDraft) => {
      budgets.setDraft(d);
      setServer((s) => ({ ...s, budgets: {} }));
      setGeneral(null);
    },
  };

  const dirty = routes.dirty || budgets.dirty;

  async function onSave() {
    if (!routes.draft || !budgets.draft) return;
    setTried(true);
    setGeneral(null);
    const nClient = Object.keys(client.routes).length + Object.keys(client.budgets).length;
    if (nClient) {
      toast.error(nClient === 1 ? 'corrija o campo marcado' : 'corrija os campos marcados');
      return;
    }
    const jobs: { ns: Ns; key: AiSettingKey; value: unknown; done: () => void }[] = [];
    if (routes.dirty) {
      const d = routes.draft;
      jobs.push({
        ns: 'routes',
        key: 'agent_runtime.routes',
        value: routesOut(d),
        done: () => routes.markSaved(d),
      });
    }
    if (budgets.dirty) {
      const d = budgets.draft;
      jobs.push({
        ns: 'budgets',
        key: 'agent_runtime.budgets',
        value: budgetsOut(d),
        done: () => budgets.markSaved(d),
      });
    }
    for (const job of jobs) {
      try {
        await save.mutateAsync({ key: job.key, value: job.value });
        job.done();
      } catch (e) {
        const field = e instanceof ApiError && e.status === 422 ? e.details?.field : undefined;
        const known =
          job.ns === 'routes' ? routePaths(routes.draft) : budgetPaths(budgets.draft, bKeys);
        const at = field === undefined ? '*' : resolveField(field, known);
        const msg =
          e instanceof ApiError && e.status === 422 ? cleanMessage(e.message) : errorMessage(e);
        if (at === '*') setGeneral(msg);
        else setServer((s) => ({ ...s, [job.ns]: { [at]: msg } }));
        toast.error(`não salvou: ${msg}`);
        return;
      }
    }
    setTried(false);
    setServer(NO_ERRORS);
    toast.success('salvo, vale em até um minuto');
  }

  function onDiscard() {
    routes.discard();
    budgets.discard();
    setTried(false);
    setServer(NO_ERRORS);
    setGeneral(null);
  }

  return (
    <Page title="IA" tabs={AI_TABS}>
      {query.isPending ? (
        <LoadingRows />
      ) : query.isError || !view ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !routes.draft || !budgets.draft ? (
        <LoadingRows />
      ) : (
        <ErrorsCtx.Provider value={shown}>
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            <StatusPanel view={view} />
            <HintPanel title="padrão" hint="vale para todos os agentes e lojas sem exceção">
              <TiersEditor
                scope="default"
                value={routes.draft.default}
                keys={keys}
                onChange={(v) => edit.routes({ ...routes.draft!, default: v })}
                emptyHint={(tier) =>
                  tier === 'fast'
                    ? 'Sem rota rápida: o Duá não responde onde não houver exceção.'
                    : 'Sem rota forte: quando uma trava bloqueia, o Duá não refaz a resposta.'
                }
              />
              <FieldMsg>{shown.routes.default}</FieldMsg>
            </HintPanel>
            <AgentOverrides
              agents={view.agents}
              draft={routes.draft}
              onChange={edit.routes}
              keys={keys}
            />
            <StoreOverrides draft={routes.draft} onChange={edit.routes} keys={keys} />
            <BudgetsPanel
              keys={bKeys}
              agents={view.agents}
              draft={budgets.draft}
              onChange={edit.budgets}
            />
            <div className="h-14" aria-hidden />
          </div>
          {(dirty || general) && (
            <div className="sticky bottom-0 z-20 mx-auto -mb-3 max-w-4xl pb-3 md:-mb-5 md:pb-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-popover px-3 py-2 shadow-pop">
                <div className="min-w-0 flex-1 text-[13px]">
                  {general ? (
                    <span className="text-destructive-foreground">não salvou: {general}</span>
                  ) : (
                    <>
                      <span className="font-medium">alterações não salvas</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {[routes.dirty && 'rotas', budgets.dirty && 'orçamentos']
                          .filter(Boolean)
                          .join(' e ')}
                      </span>
                    </>
                  )}
                </div>
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" onClick={onDiscard} disabled={save.isPending}>
                    descartar
                  </Button>
                  <Button onClick={() => void onSave()} disabled={save.isPending || !dirty}>
                    {save.isPending ? 'salvando…' : 'salvar'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </ErrorsCtx.Provider>
      )}
    </Page>
  );
}
