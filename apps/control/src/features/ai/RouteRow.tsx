import { useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ShieldAlert, Trash2 } from 'lucide-react';
import type { DirectProviderId, ModelProviderId } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { rel } from '@/lib/format.ts';
import { Button } from '@/components/ui/button.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Input, Select } from '@/components/ui/input.tsx';
import {
  catalogOptions,
  DIRECT,
  PRICE_FIELDS,
  priceDrifted,
  PROVIDERS,
  withCustomModel,
  withOption,
  withProvider,
  withZdr,
  type ModelOption,
  type PriceField,
  type RouteDraft,
} from './draft.ts';
import { FieldMsg, Notice, NumField, useFieldError } from './bits.tsx';
import { fmtContext, fmtPricePair, PROVIDER_LABEL, providerLabel } from './format.ts';
import { ModelPicker, UnverifiedMark } from './ModelPicker.tsx';
import { useAiCatalog } from './queries.ts';

const PRICE_LABEL: Record<PriceField, string> = {
  inputPerMTok: 'entrada',
  outputPerMTok: 'saída',
  cacheReadPerMTok: 'cache, leitura',
  cacheWritePerMTok: 'cache, escrita',
};

const isDirect = (p: string) => DIRECT.includes(p as DirectProviderId);
const ago = (iso: string) => (rel(iso) === 'agora' ? 'agora' : `há ${rel(iso)}`);

function ZdrSwitch({
  provider,
  checked,
  onChange,
}: {
  provider: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  const hint =
    provider === 'openrouter'
      ? 'a OpenRouter só usa provedores que não guardam nada'
      : isDirect(provider)
        ? 'marque se o contrato desta conta garante retenção zero'
        : 'recomendado: nada do que o Duá envia fica guardado';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2.5 pointer-coarse:py-1">
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
        <label
          htmlFor={id}
          className="flex min-w-0 cursor-pointer flex-col text-xs leading-5 sm:flex-row sm:gap-2"
        >
          <span className="font-medium">retenção zero de dados</span>
          <span className="text-muted-foreground">{hint}</span>
        </label>
      </div>
      {!checked && (
        <p className="flex items-start gap-1.5 pl-[2.875rem] text-xs leading-relaxed text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
          <span>o provedor pode guardar o que o Duá envia: mensagens e dados de clientes</span>
        </p>
      )}
    </div>
  );
}

function pickerFooter(provider: string, zdr: boolean, opts: ModelOption[], fetchedAt: string) {
  const n = opts.length;
  if (provider === 'openrouter')
    return zdr
      ? `${n} modelos da OpenRouter com retenção zero e ferramentas, lista atualizada ${ago(fetchedAt)}. O preço é o dos provedores com retenção zero.`
      : `${n} modelos da OpenRouter com ferramentas, lista atualizada ${ago(fetchedAt)}. O preço é o do roteamento normal.`;
  const label = providerLabel(provider);
  const unverified = opts.some((o) => !o.verified)
    ? ` “não confirmado”: o servidor não conseguiu checar o id na API da ${label}.`
    : '';
  return `${n} modelos da ${label}, com id e preço de tabela tirados da lista da OpenRouter (atualizada ${ago(fetchedAt)}).${unverified} Não está aqui? Digite o id na busca.`;
}

export function RouteRow({
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
  const [picking, setPicking] = useState(false);
  const showExtras = open || extrasErr;
  const set = (patch: Partial<RouteDraft>) => onChange({ ...r, ...patch });
  const known = PROVIDERS.includes(r.provider as ModelProviderId);
  const viaOpenRouter = r.provider === 'openrouter';
  const catalogQ = useAiCatalog();
  const catalog = known ? catalogQ.data : undefined;
  const options = useMemo(
    () => (catalog ? catalogOptions(catalog.models, r.provider, r.zdr) : null),
    [catalog, r.provider, r.zdr],
  );
  const model = r.model.trim();
  const picked = options?.find((o) => o.model === model);
  const listed = viaOpenRouter ? catalog?.models.find((m) => m.id === model) : undefined;
  const noZdr = r.zdr && listed?.zdr === null;
  const gone = viaOpenRouter && !!catalog && !!model && !listed;
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
          {!r.provider ? (
            <div className="flex h-10 items-center rounded-md border border-dashed px-2.5 text-xs text-muted-foreground md:h-8">
              escolha o provedor primeiro
            </div>
          ) : catalog && options ? (
            <ModelPicker
              options={options}
              value={model}
              invalid={!!err.model}
              open={picking}
              onOpenChange={setPicking}
              onPick={(o) => onChange(withOption(r, o))}
              onCustom={
                isDirect(r.provider)
                  ? (id) => {
                      onChange(withCustomModel(r, id));
                      setOpen(true);
                    }
                  : undefined
              }
              footer={pickerFooter(r.provider, r.zdr, options, catalog.fetchedAt)}
            />
          ) : known && catalogQ.isPending ? (
            <div className="flex h-10 items-center rounded-md border border-dashed px-2.5 text-xs text-muted-foreground md:h-8">
              carregando modelos…
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
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tnum">
            <span>
              {fmtPricePair(r.inputPerMTok, r.outputPerMTok)}
              {picked.contextLength ? ` · ${fmtContext(picked.contextLength)} de contexto` : ''}
              {picked.zdrProviders
                ? ` · ${picked.zdrProviders} ${picked.zdrProviders === 1 ? 'provedor' : 'provedores'} com retenção zero`
                : ''}
            </span>
            {!picked.verified && <UnverifiedMark />}
          </p>
        )}
        <ZdrSwitch
          provider={r.provider}
          checked={r.zdr}
          onChange={(v) => onChange(withZdr(r, v, catalog?.models))}
        />
        <FieldMsg>{err.zdr}</FieldMsg>
        {noZdr && (
          <Notice>
            Este modelo não tem provedor com retenção zero na OpenRouter: a chamada vai falhar e o
            Duá passa para a rota seguinte.{' '}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => setPicking(true)}
            >
              escolher outro
            </button>
          </Notice>
        )}
        {picked && priced && priceDrifted(r, picked.pricing) && (
          <Notice>
            {viaOpenRouter
              ? 'A OpenRouter cobra agora'
              : `O preço de tabela da ${providerLabel(r.provider)} agora é`}{' '}
            {fmtPricePair(picked.pricing.inputPerMTok, picked.pricing.outputPerMTok)}.{' '}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => onChange(withOption(r, picked))}
            >
              usar o preço atual
            </button>
          </Notice>
        )}
        {gone && (
          <Notice>
            Este modelo não está mais na lista da OpenRouter (modelos que aceitam ferramentas): as
            chamadas vão falhar e o Duá passa para a rota seguinte.{' '}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => setPicking(true)}
            >
              escolher outro
            </button>
          </Notice>
        )}
        {known && !catalog && catalogQ.isError && (
          <p className="text-xs text-muted-foreground">
            A lista de modelos não carregou agora. Digite o id do modelo
            {viaOpenRouter ? ' (como aparece no site da OpenRouter)' : ''} e o preço abaixo.{' '}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2"
              onClick={() => void catalogQ.refetch()}
            >
              tentar de novo
            </button>
          </p>
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
                : 'Preço em US$ por 1 milhão de tokens: vem da lista ao escolher o modelo; para um id digitado, preencha à mão. Vale quando o provedor não informa o custo e para estimar o gasto antes de cada chamada; sem preço, essas chamadas contam zero no orçamento.'}{' '}
              Cache vazio usa 10% (leitura) e 125% (escrita) do preço de entrada. Tempo limite vazio
              usa o padrão do servidor.
            </p>
          </div>
        )}
      </div>
    </li>
  );
}
