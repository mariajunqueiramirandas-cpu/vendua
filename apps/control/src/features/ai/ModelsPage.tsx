import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
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
  settings: { label: 'salvas aqui', variant: 'solid' },
  env: { label: 'da variável do servidor', variant: 'default' },
  none: { label: 'nenhuma', variant: 'bad' },
};

function IntroPanel({ view }: { view: AiModelsView }) {
  const src = SOURCE[view.routesSource];
  return (
    <Panel title="como funciona">
      <div className="flex flex-col gap-3">
        <p className="max-w-prose text-[13px] leading-relaxed">
          Aqui você escolhe em quais modelos de IA o Duá roda. Cada nível tem uma lista de rotas
          (provedor e modelo), tentadas em ordem: se uma falha, o Duá passa para a seguinte. As
          mudanças valem em até um minuto depois de salvar.
        </p>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          Cada rota escolhe se usa retenção zero de dados, e o recomendado é usar: nada do que o Duá
          envia fica guardado com o provedor. Pela OpenRouter, a chamada só vai a provedores que
          garantem isso; num provedor direto, vale o que o contrato da conta diz.
        </p>
        {view.routesSource === 'none' && (
          <Notice tone="bad">
            Nenhuma rota configurada: o Duá não responde até haver uma. Adicione uma rota no nível
            rápido e salve.
          </Notice>
        )}
        {view.routesSource === 'env' && (
          <Notice>
            As rotas abaixo vêm da variável AGENT_MODEL_ROUTES do servidor. Ao salvar aqui, esta
            tela passa a valer no lugar dela.
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-[13px]">
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">rotas</span>
            <Badge variant={src.variant}>{src.label}</Badge>
          </span>
          <ul
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
            aria-label="chaves dos provedores"
          >
            {view.providers.map((p) => (
              <li
                key={p.id}
                className="flex min-w-0 items-center gap-1.5"
                title={p.configured ? 'chave presente' : `sem chave (${p.secretName})`}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    p.configured ? 'bg-success' : 'bg-border-strong',
                  )}
                />
                <span className={cn(!p.configured && 'text-muted-foreground')}>
                  {providerLabel(p.id)}
                </span>
                <span className="sr-only">{p.configured ? 'chave presente' : 'sem chave'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What's inside Avançado, so a closed section never hides an exception. */
function advancedSummary(routes: RoutesDraft, budgets: BudgetsDraft) {
  const parts: string[] = [];
  const agents = routes.agents.length;
  const stores = routes.tenants.length;
  if (agents) parts.push(plural(agents, 'agente com modelo próprio', 'agentes com modelo próprio'));
  if (stores) parts.push(plural(stores, 'loja com modelo próprio', 'lojas com modelo próprio'));
  const caps = Object.values(budgets.defaults).filter((v) => v.trim());
  parts.push(caps.length ? `teto diário US$ ${caps.join(' / ')}` : 'sem teto diário');
  if (budgets.tenants.length)
    parts.push(plural(budgets.tenants.length, 'loja com teto próprio', 'lojas com teto próprio'));
  return parts.join(', ');
}

function Advanced({
  summary,
  forceOpen,
  children,
}: {
  summary: string;
  forceOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const shown = open || forceOpen;
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={shown}
        aria-controls="ai-advanced"
        onClick={() => setOpen(!shown)}
        className="flex w-full min-w-0 items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-left shadow-card hover:bg-hover"
      >
        <ChevronRight
          className={cn(
            'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
            shown && 'rotate-90',
          )}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-semibold">avançado</span>
          <span className="text-xs text-muted-foreground">
            modelos por agente e por loja, orçamento diário
          </span>
          {!shown && <span className="text-xs text-foreground/80 tnum">{summary}</span>}
        </span>
      </button>
      {shown && (
        <div id="ai-advanced" className="flex flex-col gap-4">
          {children}
        </div>
      )}
    </section>
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
  const advancedErrors =
    Object.keys(shown.budgets).length > 0 ||
    Object.keys(shown.routes).some((k) => k.startsWith('agents') || k.startsWith('tenants'));

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
            <IntroPanel view={view} />
            <HintPanel
              title="modelos do Duá"
              hint="valem em todas as lojas, salvo exceções em avançado"
            >
              <TiersEditor
                scope="default"
                value={routes.draft.default}
                keys={keys}
                onChange={(v) => edit.routes({ ...routes.draft!, default: v })}
                emptyHint={(tier) =>
                  tier === 'fast'
                    ? 'Sem rota rápida, o Duá não responde (salvo exceções em avançado).'
                    : 'Sem rota forte, quando uma trava bloqueia uma resposta o Duá não refaz.'
                }
              />
              <FieldMsg>{shown.routes.default}</FieldMsg>
            </HintPanel>
            <Advanced
              summary={advancedSummary(routes.draft, budgets.draft)}
              forceOpen={advancedErrors}
            >
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
            </Advanced>
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
