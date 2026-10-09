import type { ReactNode } from 'react';
import { Check, ChevronsUpDown, Gauge, ShieldCheck } from 'lucide-react';
import type { AiEndpoint } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/controls.tsx';
import { endpointAllowed, rankEndpoints, valueScore } from './draft.ts';
import { fmtInt, fmtPrice } from './format.ts';

const fmtTps = (tps: number | null) =>
  tps == null ? 'sem medição' : `${fmtInt(Math.round(tps))} tok/s`;
const fmtScore = (s: number) => `${fmtInt(Math.round(s))} tok/s por US$`;

function PricePair({ e }: { e: AiEndpoint }) {
  const { inputPerMTok: i, outputPerMTok: o } = e.pricing;
  return i + o === 0 ? (
    <>grátis</>
  ) : (
    <>
      {fmtPrice(i)}
      <span className="text-muted-foreground"> / </span>
      {fmtPrice(o)}
    </>
  );
}

const ZdrMark = () => (
  <span title="retenção zero de dados" className="inline-flex shrink-0 items-center">
    <ShieldCheck className="size-3.5 text-primary" aria-label="retenção zero" />
  </span>
);

function Row({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <li role="option" aria-selected={selected} aria-disabled={disabled}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'grid w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-hover focus-visible:bg-hover disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent pointer-coarse:py-2.5',
        )}
      >
        <span className="self-center">
          {selected && <Check className="size-3.5 text-primary" />}
        </span>
        {children}
      </button>
    </li>
  );
}

/**
 * Which OpenRouter provider serves a route's model: OpenRouter's routing, or one pinned endpoint.
 * Ranked by value (tokens/s per dollar); with ZDR on, endpoints that keep data are disabled.
 */
export function EndpointPicker({
  value,
  zdr,
  endpoints,
  best,
  loading,
  failed,
  onRetry,
  invalid,
  open,
  onOpenChange,
  onPick,
}: {
  value: string;
  zdr: boolean;
  endpoints: AiEndpoint[] | undefined;
  best: AiEndpoint | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  invalid?: boolean | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** '' = automático */
  onPick: (tag: string) => void;
}) {
  const current = endpoints?.find((e) => e.tag === value);
  const ranked = endpoints ? rankEndpoints(endpoints) : [];
  const hidden = zdr ? ranked.filter((e) => !e.zdr).length : 0;
  const pick = (tag: string) => {
    onPick(tag);
    onOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="provedor na OpenRouter"
          aria-invalid={invalid}
          className={cn(
            'flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-left text-base shadow-card transition-[border-color,box-shadow] focus-visible:border-ring/60 focus-visible:ring-[3px] focus-visible:ring-ring/15 focus-visible:outline-none sm:w-auto sm:max-w-full md:h-8 md:text-[13px]',
            invalid && 'border-destructive/60',
          )}
        >
          <span className="shrink-0 text-xs text-muted-foreground">provedor</span>
          {!value ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="font-medium">automático</span>
              <span className="truncate text-xs text-muted-foreground">a OpenRouter escolhe</span>
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate font-medium">{current?.provider ?? value}</span>
              {current?.zdr && <ZdrMark />}
              {current && (
                <span className="shrink-0 text-xs text-muted-foreground tnum">
                  {fmtTps(current.tps)}
                </span>
              )}
            </span>
          )}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        collisionPadding={8}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[30rem] max-w-[calc(100vw-1.5rem)] flex-col p-0"
      >
        <div className="flex items-baseline justify-between gap-3 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>melhor custo-benefício primeiro</span>
          <span className="shrink-0">US$ por 1M tokens, entrada / saída</span>
        </div>
        <ul
          role="listbox"
          aria-label="provedores"
          className="max-h-[22rem] min-h-0 flex-1 overflow-auto p-1"
        >
          <Row selected={!value} onClick={() => pick('')}>
            <span className="truncate text-[13px] font-medium">automático</span>
            <span />
            <span className="col-start-2 text-xs text-muted-foreground">
              a OpenRouter escolhe e troca de provedor se um falhar
            </span>
          </Row>
          {loading && (
            <li className="px-2 py-2 text-xs text-muted-foreground">carregando provedores…</li>
          )}
          {failed && (
            <li className="px-2 py-2 text-xs text-muted-foreground">
              A lista de provedores não carregou agora.{' '}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-2"
                onClick={onRetry}
              >
                tentar de novo
              </button>
            </li>
          )}
          {ranked.map((e) => {
            const allowed = endpointAllowed(e, zdr);
            const score = valueScore(e);
            return (
              <Row
                key={e.tag}
                selected={e.tag === value}
                disabled={!allowed && e.tag !== value}
                onClick={() => pick(e.tag)}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">{e.provider}</span>
                  {e.zdr && <ZdrMark />}
                  {best?.tag === e.tag && (
                    <Badge variant="agent-soft">
                      <Gauge />
                      <span className="hidden sm:inline">melhor custo-benefício</span>
                      <span className="sm:hidden">melhor</span>
                    </Badge>
                  )}
                </span>
                <span className="text-[13px] tnum">
                  <PricePair e={e} />
                </span>
                <span className="col-span-2 col-start-2 truncate text-xs text-muted-foreground tnum">
                  {!allowed ? (
                    <span className="text-warning-foreground">sem retenção zero</span>
                  ) : (
                    fmtTps(e.tps)
                  )}
                  {score != null && ` · ${fmtScore(score)}`}
                  <span className="hidden sm:inline">
                    {e.uptime != null && ` · ${fmtInt(Math.round(e.uptime))}% no ar`}
                    {` · ${e.tag}`}
                  </span>
                </span>
              </Row>
            );
          })}
        </ul>
        <p className="border-t px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Custo-benefício: tokens por segundo (mediana dos últimos 30 min) ÷ preço médio, com a
          entrada pesando 75%. Um provedor fixo não tem reserva na OpenRouter: se ele falhar, o Duá
          passa para a rota seguinte.
          {hidden > 0 &&
            ` Com retenção zero ligada, ${hidden} ${hidden === 1 ? 'provedor fica bloqueado' : 'provedores ficam bloqueados'}.`}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** One click to the endpoint with the most tokens/s per dollar. */
export function BestValueButton({
  best,
  current,
  measured,
  onPick,
}: {
  best: AiEndpoint | null;
  current: string;
  /** the list loaded: lets an empty result explain itself instead of looking broken */
  measured: boolean;
  onPick: (tag: string) => void;
}) {
  const active = !!best && best.tag === current;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={!best || active}
        onClick={() => best && onPick(best.tag)}
        title={best ? `${best.provider}: ${fmtScore(valueScore(best) ?? 0)}` : undefined}
        className="pointer-coarse:h-10"
      >
        {active ? <Check /> : <Gauge />}
        melhor custo-benefício
      </Button>
      {measured && !best && (
        <span className="text-xs text-muted-foreground">
          sem medição de velocidade para este modelo
        </span>
      )}
    </div>
  );
}
