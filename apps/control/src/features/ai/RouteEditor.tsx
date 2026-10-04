import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { ModelProviderId, ModelTier } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Button } from '@/components/ui/button.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Input, Select } from '@/components/ui/input.tsx';
import {
  emptyRoute,
  MAX_ROUTES,
  PRICE_FIELDS,
  PROVIDERS,
  type PriceField,
  type RouteDraft,
  type TierDraft,
} from './draft.ts';
import { FieldMsg, Notice, NumField, useFieldError } from './bits.tsx';
import { PROVIDER_LABEL, providerLabel, TIER_HINT, TIER_LABEL } from './format.ts';

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
  const priced = r.inputPerMTok.trim() || r.outputPerMTok.trim();
  const summary = [
    priced ? `US$ ${r.inputPerMTok || '?'} / ${r.outputPerMTok || '?'} por 1M tokens` : 'sem preço',
    r.timeoutS.trim() ? `tempo limite ${r.timeoutS} s` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-md border bg-card p-2 shadow-card',
        (err.row || Object.values(err).some(Boolean)) && 'border-destructive/40',
      )}
    >
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-2 md:grid-cols-[1.25rem_9.5rem_minmax(0,1fr)_auto_auto]">
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
            onChange={(e) => set({ provider: e.target.value })}
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
        <div className="col-start-3 row-start-1 flex items-center md:col-start-5">
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
          <Input
            value={r.model}
            maxLength={200}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label="modelo"
            aria-invalid={!!err.model}
            placeholder={r.provider === 'openrouter' ? 'provedor/modelo' : 'id do modelo'}
            onChange={(e) => set({ model: e.target.value })}
            className={cn(err.model && 'border-destructive/60')}
          />
          <FieldMsg>{err.model}</FieldMsg>
        </div>
        <label className="col-span-2 col-start-2 flex h-10 items-center gap-2 text-xs md:col-span-1 md:col-start-4 md:row-start-1 md:h-8">
          <Switch checked={r.zdr} onCheckedChange={(v) => set({ zdr: v })} />
          <span className={cn(!r.zdr && 'text-warning-foreground')}>retenção zero</span>
        </label>
      </div>

      <div className="flex flex-col gap-2 pl-7">
        {!r.zdr && (
          <Notice>
            {err.zdr ? `${err.zdr}. ` : ''}Ligue só se este provedor não guarda nada do que o Duá
            envia nesta conta. Sem retenção zero o servidor recusa salvar.
          </Notice>
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
              Preço em US$ por 1 milhão de tokens, opcional. Vale quando o provedor não informa o
              custo e para estimar o gasto antes de cada chamada; sem preço, essas chamadas contam
              zero no orçamento. Cache vazio usa 10% (leitura) e 125% (escrita) do preço de entrada.
              Tempo limite vazio usa o padrão do servidor.
            </p>
          </div>
        )}
      </div>
    </li>
  );
}
