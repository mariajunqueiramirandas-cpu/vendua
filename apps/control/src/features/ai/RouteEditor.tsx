import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { ModelProviderId, ModelTier } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/controls.tsx';
import { Input, Select } from '@/components/ui/input.tsx';
import {
  emptyRoute,
  MAX_ROUTES,
  PRICE_FIELDS,
  priceDrifted,
  PROVIDERS,
  withCatalogModel,
  withProvider,
  zdrImplied,
  type PriceField,
  type RouteDraft,
  type TierDraft,
} from './draft.ts';
import { FieldMsg, Notice, NumField, useFieldError } from './bits.tsx';
import {
  fmtContext,
  fmtPricePair,
  PROVIDER_LABEL,
  providerLabel,
  TIER_HINT,
  TIER_LABEL,
} from './format.ts';
import { ModelPicker } from './ModelPicker.tsx';
import { useAiCatalog } from './queries.ts';

export type KeyStatus = Partial<Record<string, boolean>>;

const PRICE_LABEL: Record<PriceField, string> = {
  inputPerMTok: 'entrada',
  outputPerMTok: 'saída',
  cacheReadPerMTok: 'cache, leitura',
  cacheWritePerMTok: 'cache, escrita',
};

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

/** OpenRouter routes pick from the ZDR catalog; direct providers take a typed id. */
function useCatalogFor(provider: string) {
  const q = useAiCatalog();
  return zdrImplied(provider) ? q : null;
}

function RouteRow({
  path,
  index,
  count,
  route: r,
  keyPresent,
  onChange,
  onMove,
  onRemove,
}: {
  path: string;
  index: number;
  count: number;
  route: RouteDraft;
  keyPresent: boolean | undefined;
  onChange: (next: RouteDraft) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const err = {
    row: useFieldError('routes', path),
    provider: useFieldError('routes', `${path}.provider`),
    model: useFieldError('routes', `${path}.model`),
    zdr: useFieldError('routes', `${path}.zdr`),
    pricing: useFieldError('routes', `${path}.pricing`),
    timeout: useFieldError('routes', `${path}.timeoutMs`),
    inputPerMTok: useFieldError('routes', `${path}.pricing.inputPerMTok`),
    outputPerMTok: useFieldError('routes', `${path}.pricing.outputPerMTok`),
    cacheReadPerMTok: useFieldError('routes', `${path}.pricing.cacheReadPerMTok`),
    cacheWritePerMTok: useFieldError('routes', `${path}.pricing.cacheWritePerMTok`),
  };
  const extrasErr = err.pricing || err.timeout || PRICE_FIELDS.some((f) => err[f]) ? true : false;
  const [open, setOpen] = useState(false);
  const showExtras = open || extrasErr;
  const set = (patch: Partial<RouteDraft>) => onChange({ ...r, ...patch });
  const known = PROVIDERS.includes(r.provider as ModelProviderId);
  const viaOpenRouter = zdrImplied(r.provider);
  const catalogQ = useCatalogFor(r.provider);
  const catalog = catalogQ?.data;
  const picked = catalog?.models.find((m) => m.id === r.model.trim());
  const priced = r.inputPerMTok.trim() || r.outputPerMTok.trim();
  const timeout = r.timeoutS.trim() ? `tempo limite ${r.timeoutS} s` : 'tempo limite padrão';
  // with a catalog pick the price line sits under the model; the toggle only says what's inside
  const summary = picked
    ? timeout
    : [priced ? fmtPricePair(r.inputPerMTok, r.outputPerMTok) : 'sem preço', timeout].join(', ');

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-md border bg-card p-2 shadow-card',
        (err.row || Object.values(err).some(Boolean)) && 'border-destructive/40',
      )}
    >
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-2 md:grid-cols-[1.25rem_9.5rem_minmax(0,1fr)_auto]">
        <span
          className="flex h-10 items-center justify-center text-xs font-medium text-muted-foreground tnum md:h-8"
          aria-label={`tentativa ${index + 1}`}
        >
          {index + 1}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <Select
            value={r.provider}
            aria-label="provedor"
            aria-invalid={!!err.provider}
            onChange={(e) => onChange(withProvider(r, e.target.value))}
          >
            <option value="" disabled>
              provedor
            </option>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
            {!known && r.provider && (
              <option value={r.provider}>{r.provider} (desconhecido)</option>
            )}
          </Select>
          <FieldMsg>{err.provider}</FieldMsg>
        </div>
        <div className="col-start-3 row-start-1 flex items-center md:col-start-4">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="subir"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="descer"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="remover rota" onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
        <div className="col-span-2 col-start-2 flex min-w-0 flex-col gap-1 md:col-span-1 md:col-start-3 md:row-start-1">
          {catalog ? (
            <ModelPicker
              models={catalog.models}
              fetchedAt={catalog.fetchedAt}
              value={r.model.trim()}
              invalid={!!err.model}
              onPick={(m) => onChange(withCatalogModel(r, m))}
            />
          ) : catalogQ?.isPending ? (
            <div className="flex h-10 items-center rounded-md border border-dashed px-2.5 text-xs text-muted-foreground md:h-8">
              carregando modelos da OpenRouter…
            </div>
          ) : (
            <Input
              value={r.model}
              maxLength={200}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-label="modelo"
              aria-invalid={!!err.model}
              placeholder={viaOpenRouter ? 'provedor/modelo' : 'id do modelo'}
              onChange={(e) => set({ model: e.target.value })}
              className={cn(err.model && 'border-destructive/60')}
            />
          )}
          <FieldMsg>{err.model}</FieldMsg>
        </div>
      </div>

      <div className="flex flex-col gap-2 pl-7">
        {picked && (
          <p className="text-xs text-muted-foreground tnum">
            {fmtPricePair(r.inputPerMTok, r.outputPerMTok)}
            {picked.contextLength ? ` · ${fmtContext(picked.contextLength)} de contexto` : ''}
          </p>
        )}
        {picked && priced && priceDrifted(r, picked) && (
          <Notice>
            A OpenRouter cobra agora{' '}
            {fmtPricePair(picked.pricing.inputPerMTok, picked.pricing.outputPerMTok)}.{' '}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => onChange(withCatalogModel(r, picked))}
            >
              usar o preço atual
            </button>
          </Notice>
        )}
        {catalog && r.model.trim() && !picked && (
          <Notice>
            Este modelo não está na lista da OpenRouter com retenção zero e ferramentas: as chamadas
            vão falhar e o Duá passa para a rota seguinte. Escolha outro.
          </Notice>
        )}
        {!catalog && catalogQ?.isError && (
          <p className="text-xs text-muted-foreground">
            A lista de modelos da OpenRouter não carregou agora. Digite o id do modelo (como aparece
            no site da OpenRouter) e o preço abaixo.{' '}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2"
              onClick={() => void catalogQ.refetch()}
            >
              tentar de novo
            </button>
          </p>
        )}
        {known && !viaOpenRouter && (
          <div className="flex flex-col gap-1">
            <label className="flex w-fit items-start gap-2 text-xs leading-relaxed pointer-coarse:py-1">
              <Checkbox
                checked={r.zdr}
                onCheckedChange={(v) => set({ zdr: v === true })}
                aria-invalid={!!err.zdr}
                className="mt-0.5"
              />
              <span>Confirmo que esta conta tem retenção zero de dados</span>
            </label>
            <FieldMsg>{err.zdr}</FieldMsg>
          </div>
        )}
        {known && keyPresent === false && (
          <Notice>
            Este servidor não tem chave de {providerLabel(r.provider)}: esta rota vai falhar e o Duá
            passa para a seguinte.
          </Notice>
        )}
        <FieldMsg>{err.row}</FieldMsg>
        <button
          type="button"
          aria-expanded={showExtras}
          onClick={() => setOpen(!showExtras)}
          className="flex w-fit max-w-full min-w-0 items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground pointer-coarse:py-1.5"
        >
          <ChevronDown
            className={cn('size-3.5 shrink-0 transition-transform', !showExtras && '-rotate-90')}
          />
          <span className="shrink-0 font-medium whitespace-nowrap">preço e tempo limite</span>
          {!showExtras && <span className="truncate tnum">{summary}</span>}
        </button>
        {showExtras && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {PRICE_FIELDS.map((f) => (
                <NumField
                  key={f}
                  label={PRICE_LABEL[f]}
                  prefix="US$"
                  value={r[f]}
                  error={err[f]}
                  onChange={(v) => set({ [f]: v })}
                />
              ))}
              <NumField
                label="tempo limite"
                suffix="s"
                value={r.timeoutS}
                error={err.timeout}
                onChange={(v) => set({ timeoutS: v })}
              />
            </div>
            <FieldMsg>{err.pricing}</FieldMsg>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {viaOpenRouter
                ? 'Preço em US$ por 1 milhão de tokens, preenchido ao escolher o modelo. O gasto registrado é o que a OpenRouter informa em cada chamada; este preço serve para estimar o gasto antes da chamada e caso ela não informe.'
                : 'Preço em US$ por 1 milhão de tokens, opcional. Vale quando o provedor não informa o custo e para estimar o gasto antes de cada chamada; sem preço, essas chamadas contam zero no orçamento.'}{' '}
              Cache vazio usa 10% (leitura) e 125% (escrita) do preço de entrada. Tempo limite vazio
              usa o padrão do servidor.
            </p>
          </div>
        )}
      </div>
    </li>
  );
}
