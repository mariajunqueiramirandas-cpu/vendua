import type { ModelTier } from '@/lib/api.ts';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { emptyRoute, MAX_ROUTES, type RouteDraft, type TierDraft } from './draft.ts';
import { FieldMsg, useFieldError } from './bits.tsx';
import { TIER_HINT, TIER_LABEL } from './format.ts';
import { RouteRow } from './RouteRow.tsx';

export type KeyStatus = Partial<Record<string, boolean>>;

/** Both tiers of one scope (padrão, an agent or a store). */
export function TiersEditor({
  scope,
  value,
  onChange,
  keys,
  emptyHint,
}: {
  scope: string;
  value: TierDraft;
  onChange: (next: TierDraft) => void;
  keys: KeyStatus;
  emptyHint: (tier: ModelTier) => string;
}) {
  return (
    <div className="flex flex-col divide-y">
      {(['fast', 'strong'] as const).map((tier) => (
        <TierList
          key={tier}
          path={`${scope}.${tier}`}
          tier={tier}
          routes={value[tier]}
          onChange={(routes) => onChange({ ...value, [tier]: routes })}
          keys={keys}
          emptyHint={emptyHint(tier)}
        />
      ))}
    </div>
  );
}

function TierList({
  path,
  tier,
  routes,
  onChange,
  keys,
  emptyHint,
}: {
  path: string;
  tier: ModelTier;
  routes: RouteDraft[];
  onChange: (next: RouteDraft[]) => void;
  keys: KeyStatus;
  emptyHint: string;
}) {
  const err = useFieldError('routes', path);
  const move = (i: number, d: -1 | 1) => {
    const next = [...routes];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  return (
    <section className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-[13px] font-semibold">{TIER_LABEL[tier]}</h3>
        <p className="text-xs text-muted-foreground">{TIER_HINT[tier]}</p>
      </div>
      {routes.length ? (
        <ol className="flex flex-col gap-2">
          {routes.map((r, i) => (
            <RouteRow
              key={r.uid}
              path={`${path}.${i}`}
              index={i}
              count={routes.length}
              route={r}
              keyPresent={keys[r.provider]}
              onChange={(next) => onChange(routes.map((x, j) => (j === i ? next : x)))}
              onMove={(d) => move(i, d)}
              onRemove={() => onChange(routes.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      )}
      <FieldMsg>{err}</FieldMsg>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2"
          disabled={routes.length >= MAX_ROUTES}
          onClick={() => onChange([...routes, emptyRoute()])}
        >
          <Plus /> {routes.length ? 'adicionar alternativa' : 'adicionar rota'}
        </Button>
        {routes.length > 1 && (
          <span className="text-xs text-muted-foreground">
            em ordem: se uma falha, o Duá tenta a seguinte
          </span>
        )}
      </div>
    </section>
  );
}
