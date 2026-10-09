import {
  CaretDown,
  Check,
  CheckCircle,
  Circle,
  Gift,
  LockSimple,
  Sparkle,
  Table,
} from '@phosphor-icons/react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Plan, PlanFeature } from '../lib/api.ts';
import { money } from '../lib/format.ts';
import { haptic } from '../lib/haptics.ts';
import { cn } from './cn.ts';
import { Mascote } from './Mascote.tsx';
import {
  PerkText,
  PlanBadge,
  perksAdded,
  perksOf,
  perMonth,
  prevOf,
  publicPlans,
  shortName,
} from './PlanCard.tsx';

// Where an owner picks a plan (signup, Conta's sheet): the cards, the trial up front and the full
// comparison. Everything is said from Core's plan rows (features, limits, price, trial), so staff
// can rename, reprice or regate a plan in the CRM without a change here.

const count = (n: number) => n.toLocaleString('pt-BR');

export const FEATURE_LABEL: Record<PlanFeature, string> = {
  kds: 'a Cozinha (KDS)',
  printing: 'a impressão automática',
  loyalty: 'o cartão fidelidade',
  vendedor: 'o Duá, vendedor com IA',
  copilot: 'o Duá Copiloto no painel',
  pdv: 'o PDV, com caixa e mesas',
  customDomain: 'o domínio próprio',
  customSite: 'o site personalizado',
};

/** "a, b nem c": what a plan leaves out, said the way people say it */
const listNem = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} nem ${xs[xs.length - 1]}`;

/** One line on what the plan is for, from its biggest features. */
export function promiseOf(p: Plan): string {
  const f = p.features;
  if (f.customDomain && f.customSite)
    return 'A sua marca no seu domínio, com um site feito por IA.';
  if (f.customDomain) return 'A sua marca no seu próprio domínio.';
  if (f.customSite) return 'Um site feito para a sua marca, por IA.';
  if (f.vendedor)
    return f.kds || f.printing
      ? 'O Duá vende por você no WhatsApp, e a cozinha fica em ordem.'
      : 'O Duá vende por você no WhatsApp.';
  if (f.kds || f.printing) return 'A cozinha em ordem, do pedido à comanda.';
  if (f.loyalty) return 'O cliente volta, com o cartão fidelidade.';
  return 'A loja online com o seu nome, pronta para vender.';
}

/** What a plan cheaper than the recommended one leaves out of it (null when nothing). */
export function lacksOf(p: Plan, rec: Plan): string | null {
  const lost = (Object.keys(FEATURE_LABEL) as PlanFeature[]).filter(
    (f) => rec.features[f] && !p.features[f],
  );
  return lost.length ? `Não inclui ${listNem(lost.map((f) => FEATURE_LABEL[f]))}.` : null;
}

/** "R$ 169" big and ",00/mês" small */
function Price({ cents, hero }: { cents: number; hero?: boolean }) {
  const s = money(cents);
  const at = s.lastIndexOf(',');
  const whole = at > 0 ? s.slice(0, at) : s;
  const frac = at > 0 ? s.slice(at) : '';
  return (
    <span
      className={cn(
        'tnum inline-flex items-baseline font-display font-semibold tracking-tight',
        hero
          ? 'rounded-md bg-spark px-3 py-1 text-[2.25rem] leading-[2.75rem] text-on-spark'
          : 'text-[1.75rem] leading-9',
      )}
    >
      {whole}
      <span className={cn(hero ? 'text-[1.125rem]' : 'text-[1rem]')}>{frac}</span>
      <span
        className={cn(
          'ml-0.5 font-sans font-medium',
          hero ? 'text-[1rem]' : 'text-[0.9375rem] text-muted',
        )}
      >
        /mês
      </span>
    </span>
  );
}

type Look = 'base' | 'hero' | 'top';

/** Said where a closed plan's choice would be (ADR 0032: Pangolim waits on own domains). */
export const CLOSED_LINE = 'Ainda não está aberto para assinatura.';

/** A plan as a radio card: name, monthly price, a promise, Duá and what it adds. A plan that isn't
 * open shows all of that but can't be picked. */
export function PlanOption({
  plan,
  selected,
  onSelect,
  address,
  badge,
  disabled,
  trial,
  prev,
  look = plan.recommended ? 'hero' : 'top',
  lacks,
  tabIndex,
  className,
}: {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
  address: string;
  /** what the caller says about the plan ("seu plano") */
  badge?: string | undefined;
  disabled?: boolean;
  /** a new store: the plan's free days show (a running subscription never trials again) */
  trial?: boolean | undefined;
  /** the plan below in the list: the card then lists only what this one adds */
  prev?: Plan | undefined;
  /** base: the entry plan, flat; hero: the recommended one, raised; top: the rest */
  look?: Look;
  /** what it leaves out of the recommended plan */
  lacks?: string | null | undefined;
  tabIndex?: number;
  className?: string | undefined;
}) {
  const price = perMonth(plan);
  const hero = look === 'hero';
  const f = plan.features;
  const closed = !plan.available;
  const trialOn = !!trial && plan.trialDays > 0 && !closed;
  const all = prev ? perksAdded(plan, prev, address, { trial }) : perksOf(plan, address, { trial });
  // Duá has its own tile; the list keeps it only when it's all the plan adds
  const perks =
    f.vendedor && all.some((p) => p.key !== 'vendedor')
      ? all.filter((p) => p.key !== 'vendedor')
      : f.vendedor
        ? []
        : all;
  const vsPrev =
    prev?.features.vendedor && plan.aiConversations > prev.aiConversations
      ? `o ${shortName(prev)} tem ${count(prev.aiConversations)}`
      : null;
  const id = `plan-${plan.id}`;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${plan.name}${price ? `, ${price}` : ''}${plan.recommended ? ', recomendado' : ''}${badge ? `, ${badge}` : ''}${closed ? `. ${CLOSED_LINE}` : ''}`}
      aria-describedby={`${id}-perks`}
      aria-disabled={closed || undefined}
      disabled={disabled}
      tabIndex={tabIndex}
      data-plan={plan.id}
      onClick={() => {
        if (closed) return;
        haptic.tick();
        onSelect();
      }}
      className={cn(
        'relative flex w-full min-w-0 flex-col text-left',
        'transition-[scale,box-shadow,background-color,border-color] duration-(--duration-quick) active:scale-[0.99]',
        'disabled:pointer-events-none disabled:opacity-60',
        closed && 'cursor-default active:scale-100',
        hero
          ? cn(
              'gap-4 rounded-xl bg-raised bg-linear-to-b from-spark-soft to-raised to-45% px-5 pb-6 pt-8 depth-3 md:px-6',
              selected ? 'ring-[3px] ring-primary' : 'ring-2 ring-spark',
            )
          : look === 'base'
            ? cn(
                'gap-3.5 rounded-lg border-2 p-5',
                !closed && 'hover:bg-hover',
                selected
                  ? 'border-solid border-primary bg-surface'
                  : 'border-dashed border-line-strong bg-transparent',
              )
            : cn(
                'gap-3.5 rounded-lg bg-surface p-5 depth-1',
                !closed && 'hover:bg-hover',
                selected ? 'ring-2 ring-primary' : 'ring-1 ring-line-strong',
              ),
        className,
      )}
    >
      {hero ? (
        <span className="t-label absolute -top-3.5 left-5 inline-flex -rotate-2 items-center gap-1.5 rounded-full bg-spark px-3 py-1.5 font-display font-bold text-on-spark depth-1">
          <Sparkle weight="fill" className="size-4" aria-hidden /> Recomendado
        </span>
      ) : null}
      <span className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'font-display font-semibold tracking-tight',
                hero ? 'text-[1.375rem] leading-7' : 't-title-2',
              )}
            >
              {plan.name}
            </span>
            {badge ? <PlanBadge>{badge}</PlanBadge> : null}
          </span>
          {plan.priceCents !== null ? (
            <span className={cn('block', hero ? 'mt-2.5' : 'mt-1')}>
              <Price cents={plan.priceCents} hero={hero} />
            </span>
          ) : null}
        </span>
        {closed ? null : selected ? (
          <CheckCircle weight="fill" className="size-8 shrink-0 text-primary" aria-hidden />
        ) : (
          <Circle className="size-8 shrink-0 text-faint" aria-hidden />
        )}
      </span>

      <span id={`${id}-perks`} className="flex flex-col gap-3.5">
        {trialOn ? (
          <span className="t-label inline-flex items-center gap-1.5 self-start rounded-full bg-success-soft px-2.5 py-1 text-success">
            <Gift weight="fill" className="size-4" aria-hidden /> {plan.trialDays} dias grátis, sem
            cartão
          </span>
        ) : null}
        <span className={cn('block font-medium', hero ? 't-body-lg' : 't-body')}>
          {promiseOf(plan)}
        </span>
        {lacks ? <span className="t-caption -mt-2 block text-muted">{lacks}</span> : null}

        {f.vendedor ? (
          <span
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2.5',
              hero ? 'bg-surface ring-1 ring-line' : 'bg-sunken',
            )}
          >
            <span className="dua-disc grid size-11 shrink-0 place-items-center overflow-hidden bg-spark-soft">
              <Mascote pose="avatar-ola" size={44} />
            </span>
            <span className="min-w-0">
              <span className="t-caption block text-muted">Duá, vendedor com IA no WhatsApp</span>
              <span className="tnum block font-semibold">
                {count(plan.aiConversations)} conversas/mês
              </span>
              <span className="t-caption block text-muted">
                {trialOn && plan.aiTrialConversations > 0
                  ? `${count(plan.aiTrialConversations)} no teste grátis`
                  : (vsPrev ?? 'cada cliente conta uma vez a cada 24 h')}
              </span>
            </span>
          </span>
        ) : null}

        {perks.length ? (
          <span className="block border-t border-line pt-3.5">
            {prev ? (
              <span className="t-label mb-2.5 block font-semibold">
                Tudo do {shortName(prev)}, e mais:
              </span>
            ) : null}
            <span className="flex flex-col gap-2.5">
              {perks.map((p) => (
                <span key={p.key} className="flex gap-2.5">
                  <CheckCircle
                    weight="fill"
                    className="mt-0.5 size-5 shrink-0 text-success"
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block break-words font-medium">
                      <PerkText p={p} />
                    </span>
                    <span className="t-caption block text-muted">{p.sub}</span>
                  </span>
                </span>
              ))}
            </span>
          </span>
        ) : null}
        {closed ? (
          <span className="t-label flex items-center gap-2 border-t border-line pt-3.5 text-muted">
            <LockSimple weight="bold" className="size-4 shrink-0" aria-hidden />
            {CLOSED_LINE}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * The public plans as one radiogroup, cheapest first: the entry plan flat, the recommended one
 * raised and the biggest, the rest a plain card. `wide` lays three side by side on a desktop.
 */
export function PlanCards({
  plans,
  selected,
  onSelect,
  address,
  trial,
  badge,
  wide,
  className,
}: {
  plans: Plan[];
  selected: string | null | undefined;
  onSelect: (id: string) => void;
  address: string;
  trial?: boolean | undefined;
  badge?: ((p: Plan) => string | undefined) | undefined;
  wide?: boolean;
  className?: string;
}) {
  const list = publicPlans(plans);
  const rec = list.find((p) => p.recommended);
  const group = useRef<HTMLDivElement>(null);
  const at = Math.max(
    0,
    list.findIndex((p) => p.id === selected),
  );
  // a radiogroup: the arrows move the choice, Tab leaves the group
  const onKey = (e: KeyboardEvent) => {
    const step =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0;
    const open = list.filter((p) => p.available);
    if (!step || !open.length) return;
    e.preventDefault();
    const from = Math.max(
      0,
      open.findIndex((p) => p.id === selected),
    );
    const next = open[(from + step + open.length) % open.length]!;
    onSelect(next.id);
    group.current?.querySelector<HTMLElement>(`[data-plan="${next.id}"]`)?.focus();
  };
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="planos"
      onKeyDown={onKey}
      className={cn(
        'grid gap-6',
        wide &&
          list.length === 3 &&
          'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start lg:gap-5',
        className,
      )}
    >
      {list.map((p, i) => {
        const look: Look = p.recommended
          ? 'hero'
          : rec && p.priceCents! < rec.priceCents!
            ? 'base'
            : 'top';
        return (
          <PlanOption
            key={p.id}
            plan={p}
            selected={selected === p.id}
            onSelect={() => onSelect(p.id)}
            address={address}
            trial={trial}
            prev={prevOf(list, p)}
            look={look}
            lacks={look === 'base' && rec ? lacksOf(p, rec) : null}
            badge={badge?.(p)}
            tabIndex={i === at ? 0 : -1}
            // side by side, the recommended card stands taller than its neighbours
            className={wide && look !== 'hero' ? 'lg:mt-8' : undefined}
          />
        );
      })}
    </div>
  );
}

/** The free trial, before the cards: it names the plan it belongs to and picks it. */
export function PlanTrialStrip({
  plan,
  selected,
  onPick,
}: {
  plan: Plan;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-spark p-5 text-on-spark depth-2 noite:bg-spark-soft noite:text-ink noite:ring-1 noite:ring-spark/40 md:flex-row md:items-center md:gap-5 md:p-6">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span
          aria-hidden
          className="grid size-12 shrink-0 -rotate-6 place-items-center rounded-full bg-surface text-ink depth-1 noite:bg-spark noite:text-on-spark"
        >
          <Gift weight="duotone" className="size-7" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-[1.25rem] font-semibold leading-7 tracking-tight">
            Comece pelo {plan.name}: {plan.trialDays} dias grátis, sem cartão.
          </p>
          <p className="t-body mt-1">
            No teste vem tudo do {shortName(plan)}
            {plan.features.vendedor && plan.aiTrialConversations > 0
              ? `, com ${count(plan.aiTrialConversations)} conversas do Duá`
              : ''}
            . Você só escolhe como pagar depois.
          </p>
        </div>
      </div>
      <div className="shrink-0 max-md:pl-16">
        {selected ? (
          <p className="t-label inline-flex min-h-11 items-center gap-1.5 rounded-md bg-surface/40 px-3.5 noite:bg-spark/15">
            <CheckCircle weight="fill" className="size-5" aria-hidden /> {shortName(plan)} escolhido
          </p>
        ) : (
          <button
            type="button"
            onClick={() => {
              haptic.tick();
              onPick();
            }}
            className="t-label press inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-on-primary depth-1 hover:bg-primary-hover noite:bg-spark noite:text-on-spark"
          >
            começar pelo teste do {shortName(plan)}
          </button>
        )}
      </div>
    </div>
  );
}

type Cell = boolean | string;
interface Row {
  name: string;
  cells: Cell[];
  notes?: (string | undefined)[];
}

// in every plan: what the store itself is (the site's comparison says the same)
const EVERY = [
  'Loja online com o seu nome',
  'App de pedidos no celular',
  'Pix na sua conta do Mercado Pago',
  'Cardápio, estoque e encomendas',
  'Entrega e retirada',
  'Cupons e lista de espera',
  'Relatórios',
  'Equipe',
];

/** "Comparar os planos": every plan side by side, grouped like the site's table. */
export function PlanCompare({
  plans,
  trial,
  current,
  className,
}: {
  plans: Plan[];
  /** a new store: the trial's row and the trial's conversations show */
  trial?: boolean | undefined;
  /** the store's plan, marked "seu plano" in its column */
  current?: string | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const list = publicPlans(plans);
  const feat = (name: string, f: PlanFeature): Row => ({
    name,
    cells: list.map((p) => p.features[f]),
  });
  const groups: { name: string; rows: Row[] }[] = [
    { name: 'Loja e pedidos', rows: EVERY.map((name) => ({ name, cells: list.map(() => true) })) },
    {
      name: 'Cozinha',
      rows: [feat('Tela da cozinha', 'kds'), feat('Impressão automática da comanda', 'printing')],
    },
    {
      name: 'Balcão e mesas',
      rows: [feat('Caixa, vendas no balcão e comandas nas mesas', 'pdv')],
    },
    { name: 'Clientes', rows: [feat('Cartão fidelidade', 'loyalty')] },
    {
      name: 'Duá, vendedor com IA no WhatsApp',
      rows: [
        {
          name: 'Conversas por mês',
          cells: list.map((p) => (p.features.vendedor ? count(p.aiConversations) : false)),
          notes: list.map((p) =>
            trial && p.trialDays > 0 && p.features.vendedor && p.aiTrialConversations > 0
              ? `${count(p.aiTrialConversations)} no teste`
              : undefined,
          ),
        },
      ],
    },
    {
      name: 'Duá Copiloto no painel',
      rows: [feat('Pergunte da loja e confirme mudanças', 'copilot')],
    },
    {
      name: 'Marca',
      rows: [
        feat('Domínio próprio', 'customDomain'),
        feat('Site feito pelo nosso agente de IA', 'customSite'),
      ],
    },
    {
      name: 'Para começar',
      rows: [
        {
          name: 'Taxa da Venduá por pedido',
          cells: list.map((p) =>
            p.feeBps > 0 ? `${(p.feeBps / 100).toLocaleString('pt-BR')}%` : 'nenhuma',
          ),
        },
        ...(trial && list.some((p) => p.trialDays > 0)
          ? [
              {
                name: 'Teste antes de pagar',
                cells: list.map((p) =>
                  p.trialDays > 0 ? `${p.trialDays} dias, sem cartão` : false,
                ),
              },
            ]
          : []),
      ],
    },
  ]
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.cells.some((c) => c !== false)) }))
    .filter((g) => g.rows.length);
  const recAt = list.findIndex((p) => p.recommended);

  return (
    <section className={cn('rounded-lg bg-surface depth-1', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-16 w-full items-center gap-3 rounded-lg px-4 py-3 text-left hover:bg-hover"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken">
          <Table className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Comparar os planos</span>
          <span className="t-caption block text-muted">tudo o que vem em cada um, lado a lado</span>
        </span>
        <CaretDown
          className={cn('size-5 shrink-0 text-muted transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      <div id={panel} hidden={!open} className="border-t border-line px-3 pb-4 sm:px-5">
        <table className="w-full table-fixed border-collapse text-[0.875rem] leading-[1.3] sm:text-[0.9375rem]">
          <caption className="sr-only">O que vem em cada plano</caption>
          <colgroup>
            <col />
            {list.map((p, i) => (
              <col
                key={p.id}
                className={cn('w-[4.25rem] sm:w-[22%]', i === recAt && 'bg-spark-soft')}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              <td />
              {list.map((p) => (
                <th
                  key={p.id}
                  scope="col"
                  className="border-b-2 border-line-strong px-1 pb-3 pt-4 align-bottom font-normal sm:px-2"
                >
                  {p.id === current ? (
                    <span className="t-caption mb-1 block font-semibold text-muted">seu plano</span>
                  ) : null}
                  <span className="block font-display font-semibold leading-tight sm:text-[1rem]">
                    {shortName(p)}
                  </span>
                  {p.priceCents !== null ? (
                    <span className="tnum t-caption mt-0.5 block font-semibold text-muted">
                      {money(p.priceCents)}
                      <span className="max-sm:block">/mês</span>
                    </span>
                  ) : null}
                  {!p.available ? (
                    <span className="t-caption mt-0.5 block text-muted">ainda fechado</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.name}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={list.length + 1}
                  className="border-b border-line-strong bg-surface pb-1.5 pt-5 text-left font-display font-semibold"
                >
                  {g.name}
                </th>
              </tr>
              {g.rows.map((r, ri) => (
                <tr key={r.name} className={cn(ri > 0 && '[&>*]:border-t [&>*]:border-line')}>
                  <th scope="row" className="py-2.5 pr-2 text-left font-medium">
                    {r.name}
                  </th>
                  {r.cells.map((c, i) => (
                    <td key={i} className="px-1 py-2.5 text-center align-middle sm:px-2">
                      {c === true ? (
                        <>
                          <Check weight="bold" className="inline size-5 text-success" aria-hidden />
                          <span className="sr-only">incluso</span>
                        </>
                      ) : c === false ? (
                        <>
                          <span className="text-faint" aria-hidden>
                            —
                          </span>
                          <span className="sr-only">não inclui</span>
                        </>
                      ) : (
                        <span
                          className={cn(
                            'tnum font-semibold',
                            c.length > 8 && 't-caption block text-success',
                          )}
                        >
                          {c}
                        </span>
                      )}
                      {r.notes?.[i] ? (
                        <span className="t-caption block text-muted">{r.notes[i]}</span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
