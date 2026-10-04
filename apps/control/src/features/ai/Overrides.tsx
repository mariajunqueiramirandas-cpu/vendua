import type { AiModelsView } from '@/lib/api.ts';
import { Button } from '@/components/ui/button.tsx';
import { emptyTiers, scopePath, type RoutesDraft, type Scoped, type TierDraft } from './draft.ts';
import {
  FieldMsg,
  HintPanel,
  StoreName,
  StorePicker,
  useFieldError,
  useStoreLookup,
} from './bits.tsx';
import { TIER_LABEL } from './format.ts';
import { TiersEditor, type KeyStatus } from './RouteEditor.tsx';

type Agent = AiModelsView['agents'][number];

const upsert = (list: Scoped<TierDraft>[], id: string, value: TierDraft) =>
  list.some((x) => x.id === id)
    ? list.map((x) => (x.id === id ? { id, value } : x))
    : [...list, { id, value }];

function ScopeError({ path }: { path: string }) {
  return <FieldMsg>{useFieldError('routes', path)}</FieldMsg>;
}

/** One agent everywhere: overrides the padrão for that agent in every store. */
export function AgentOverrides({
  agents,
  draft,
  onChange,
  keys,
}: {
  agents: Agent[];
  draft: RoutesDraft;
  onChange: (next: RoutesDraft) => void;
  keys: KeyStatus;
}) {
  // overrides for ids the server no longer lists stay visible so a save doesn't drop them silently
  const rows: Agent[] = [
    ...agents,
    ...draft.agents
      .filter((o) => !agents.some((a) => a.id === o.id))
      .map((o) => ({ id: o.id, label: o.id, budgetKey: null, defaultTier: 'fast' as const })),
  ];
  const set = (agents: Scoped<TierDraft>[]) => onChange({ ...draft, agents });
  return (
    <HintPanel title="por agente" hint="troca o padrão para um agente em todas as lojas" flush>
      {rows.length ? (
        <ul className="divide-y">
          {rows.map((a) => {
            const o = draft.agents.find((x) => x.id === a.id);
            const path = scopePath('agents', a.id);
            return (
              <li key={a.id} className="flex flex-col gap-3 p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{a.label}</span>
                  {a.label !== a.id && (
                    <span className="text-xs text-muted-foreground">{a.id}</span>
                  )}
                  {a.defaultTier === 'strong' && (
                    <span className="text-xs text-muted-foreground">
                      começa no {TIER_LABEL.strong}
                    </span>
                  )}
                  <div className="ml-auto">
                    {o ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => set(draft.agents.filter((x) => x.id !== a.id))}
                      >
                        voltar ao padrão
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => set(upsert(draft.agents, a.id, emptyTiers()))}
                      >
                        personalizar
                      </Button>
                    )}
                  </div>
                </div>
                {o ? (
                  <TiersEditor
                    scope={path}
                    value={o.value}
                    keys={keys}
                    onChange={(v) => set(upsert(draft.agents, a.id, v))}
                    emptyHint={() => 'vazio: usa o padrão'}
                  />
                ) : (
                  <p className="-mt-2 text-xs text-muted-foreground">usa o padrão</p>
                )}
                <ScopeError path={path} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="p-3 text-xs text-muted-foreground">nenhum agente registrado</p>
      )}
      <div className="border-t px-3 py-2 empty:hidden">
        <ScopeError path="agents" />
      </div>
    </HintPanel>
  );
}

/** One store, every agent: wins over the agent and padrão routes. */
export function StoreOverrides({
  draft,
  onChange,
  keys,
}: {
  draft: RoutesDraft;
  onChange: (next: RoutesDraft) => void;
  keys: KeyStatus;
}) {
  const stores = useStoreLookup();
  const set = (tenants: Scoped<TierDraft>[]) => onChange({ ...draft, tenants });
  return (
    <HintPanel
      title="por loja"
      hint="vale para todos os agentes da loja e passa na frente das outras regras"
      flush
      actions={
        <StorePicker
          exclude={new Set(draft.tenants.map((t) => t.id))}
          onPick={(id) => set(upsert(draft.tenants, id, emptyTiers()))}
        />
      }
    >
      {draft.tenants.length ? (
        <ul className="divide-y">
          {draft.tenants.map((t) => {
            const path = scopePath('tenants', t.id);
            return (
              <li key={t.id} className="flex flex-col gap-3 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <StoreName id={t.id} store={stores.get(t.id)} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => set(draft.tenants.filter((x) => x.id !== t.id))}
                  >
                    remover
                  </Button>
                </div>
                <TiersEditor
                  scope={path}
                  value={t.value}
                  keys={keys}
                  onChange={(v) => set(upsert(draft.tenants, t.id, v))}
                  emptyHint={() => 'vazio: segue a regra do agente ou o padrão'}
                />
                <ScopeError path={path} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="p-3 text-xs text-muted-foreground">nenhuma loja com rota própria</p>
      )}
      <div className="border-t px-3 py-2 empty:hidden">
        <ScopeError path="tenants" />
      </div>
    </HintPanel>
  );
}
