import {
  CashRegister,
  ForkKnife,
  Minus,
  NotePencil,
  Plus,
  Storefront,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { PdvDiscountIn, PdvQuote } from '../../lib/api.ts';
import { clock, money } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { Button } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { Chips, Field, MoneyField, Segmented, TextInput } from '../../ui/fields.tsx';
import { HelpButton } from '../../ui/Page.tsx';
import { CaixaBadge } from '../../ui/pdv/MethodPicker.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { usePdvState, type PickedLine, type Ticket } from './data.ts';

// ── the PDV's own tabs, with the caixa's state beside them ─────────────────

const TABS = [
  { to: '/pdv', label: 'Vender', Icon: Storefront, on: (p: string) => p === '/pdv' },
  {
    to: '/pdv/mesas',
    label: 'Mesas',
    Icon: ForkKnife,
    on: (p: string) => p.startsWith('/pdv/mesas') || p.startsWith('/pdv/comanda'),
  },
  {
    to: '/pdv/caixa',
    label: 'Caixa',
    Icon: CashRegister,
    on: (p: string) => p.startsWith('/pdv/caixa'),
  },
];

export function PdvTop({
  title,
  className,
  heading = true,
}: {
  title: string;
  className?: string;
  /** false when the screen names itself in a visible h1 */
  heading?: boolean;
}) {
  const { pathname } = useLocation();
  const { data } = usePdvState();
  const caixa = data?.caixa;
  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 md:mb-6', className)}>
      {heading ? <h1 className="sr-only">{title}</h1> : null}
      <nav aria-label="PDV" className="flex w-full gap-1 rounded-md bg-sunken p-1 sm:w-auto">
        {TABS.map((t) => {
          const on = t.on(pathname);
          return (
            <Link
              key={t.to}
              to={t.to}
              // siblings swap in place: back leaves the PDV instead of walking its tabs
              replace={pathname !== '/pdv' && t.to !== '/pdv'}
              state={{ vt: 'fade' }}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'press t-label flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[12px] px-4 sm:flex-none',
                on ? 'bg-surface text-ink depth-1' : 'text-muted hover:text-ink',
              )}
            >
              <t.Icon weight={on ? 'fill' : 'duotone'} className="size-5" aria-hidden />
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-1 items-center justify-between gap-2 sm:justify-end">
        {data ? (
          <Link
            to="/pdv/caixa"
            state={{ vt: 'fade' }}
            className="press rounded-full"
            aria-label={
              caixa
                ? `caixa aberto desde ${clock(caixa.openedAt)}: ver o caixa`
                : 'caixa fechado: abrir o caixa'
            }
          >
            <CaixaBadge
              open={!!caixa}
              detail={caixa ? `desde ${clock(caixa.openedAt)}` : 'abrir'}
            />
          </Link>
        ) : (
          <span className="h-8" />
        )}
        <HelpButton className="-mr-2" />
      </div>
    </div>
  );
}

// ── the ticket's lines, with Core's figures beside them ────────────────────

const choiceOf = (l: PickedLine) =>
  [
    ...l.modifiers.map((m) => (m.qty > 1 ? `${m.qty}× ${m.name}` : m.name)),
    ...l.combo.map((c) => `${c.qty}× ${c.name}`),
  ]
    .filter(Boolean)
    .join(' · ');

export function TicketLines({
  ticket,
  quote,
  fresh,
  errorLine,
  errorText,
}: {
  ticket: Ticket;
  quote: PdvQuote | null;
  fresh: boolean;
  errorLine: number | null;
  errorText: string | null;
}) {
  const [noting, setNoting] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-line" aria-label="itens da conta">
      {ticket.lines.map((l, i) => {
        // Core answers line by line, in the order asked
        const q = quote && quote.lines.length === ticket.lines.length ? quote.lines[i] : undefined;
        const bad = errorLine === i;
        const choice = choiceOf(l);
        return (
          <li key={l.key} className={cn('py-3', bad && '-mx-2 rounded-md bg-danger-soft px-2')}>
            <div className="flex items-start gap-2">
              <span className="inline-flex shrink-0 items-center rounded-full bg-sunken">
                <button
                  type="button"
                  aria-label={l.qty === 1 ? `tirar ${l.name}` : `menos um ${l.name}`}
                  onClick={() => {
                    haptic.tick();
                    ticket.setQty(l.key, l.qty - 1);
                  }}
                  className="press grid size-10 place-items-center rounded-full hover:bg-press"
                >
                  {l.qty === 1 ? (
                    <Trash className="size-4.5 text-danger" />
                  ) : (
                    <Minus weight="bold" className="size-4.5" />
                  )}
                </button>
                <output className="tnum min-w-6 text-center font-semibold" aria-live="polite">
                  {l.qty}
                </output>
                <button
                  type="button"
                  aria-label={`mais um ${l.name}`}
                  disabled={l.qty >= 99}
                  onClick={() => {
                    haptic.tick();
                    ticket.setQty(l.key, l.qty + 1);
                  }}
                  className="press grid size-10 place-items-center rounded-full hover:bg-press disabled:opacity-35"
                >
                  <Plus weight="bold" className="size-4.5" />
                </button>
              </span>
              <div className="min-w-0 flex-1 pt-2">
                <p className="t-body font-semibold leading-snug">{q?.name ?? l.name}</p>
                {choice ? <p className="t-caption text-muted">{choice}</p> : null}
                {l.note && noting !== l.key ? (
                  <button
                    type="button"
                    onClick={() => setNoting(l.key)}
                    className="t-caption mt-0.5 flex items-start gap-1 text-left font-semibold"
                  >
                    <NotePencil weight="bold" className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <span className="min-w-0 break-words">{l.note}</span>
                  </button>
                ) : null}
                {bad && errorText ? (
                  <p className="t-caption mt-1 flex items-start gap-1 font-semibold text-danger">
                    <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0" />
                    {errorText}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5 pt-2">
                <span
                  className={cn(
                    'tnum t-body font-semibold transition-opacity',
                    !fresh && 'opacity-45',
                  )}
                >
                  {q ? money(q.lineTotalCents) : '—'}
                </span>
                {!l.note && noting !== l.key ? (
                  <button
                    type="button"
                    onClick={() => setNoting(l.key)}
                    className="t-caption -mr-1 min-h-8 rounded-sm px-1 font-semibold text-muted hover:text-ink"
                  >
                    + obs.
                  </button>
                ) : null}
              </div>
            </div>
            {noting === l.key ? (
              <NoteInput
                value={l.note}
                onDone={(v) => {
                  ticket.setNote(l.key, v);
                  setNoting(null);
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function NoteInput({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="mt-2 flex gap-2">
      <TextInput
        autoFocus
        aria-label="observação do item"
        placeholder="sem cebola, bem passado…"
        maxLength={140}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onDone(v);
          }
        }}
        onBlur={() => onDone(v)}
        className="h-11 lg:h-11"
      />
    </div>
  );
}

/** Core's totals for the ticket; while it re-prices, the last ones fade and say so. */
export function Totals({
  quote,
  fresh,
  pending,
  extra,
  className,
}: {
  quote: PdvQuote | null;
  fresh: boolean;
  pending: boolean;
  extra?: ReactNode;
  className?: string;
}) {
  return (
    <dl className={cn('t-body space-y-1', className)} aria-busy={pending || undefined}>
      {quote && (quote.discountCents || quote.delivery) ? (
        <div className={cn('flex justify-between text-muted', !fresh && 'opacity-45')}>
          <dt>Subtotal</dt>
          <dd className="tnum">{money(quote.subtotalCents)}</dd>
        </div>
      ) : null}
      {quote && quote.discountCents ? (
        <div className={cn('flex justify-between text-success', !fresh && 'opacity-45')}>
          <dt>Desconto</dt>
          <dd className="tnum">−{money(quote.discountCents)}</dd>
        </div>
      ) : null}
      {quote?.delivery ? (
        <div className={cn('flex justify-between gap-3 text-muted', !fresh && 'opacity-45')}>
          <dt className="min-w-0 truncate">
            Entrega
            {quote.delivery.zoneName ? ` · ${quote.delivery.zoneName}` : ' · taxa digitada'}
          </dt>
          <dd className="tnum shrink-0">
            {quote.delivery.feeCents ? `+${money(quote.delivery.feeCents)}` : 'grátis'}
          </dd>
        </div>
      ) : null}
      {extra}
      <div className="flex items-baseline justify-between gap-3 pt-1">
        <dt className="t-title-2 flex items-center gap-2">
          Total
          {pending ? <Spinner className="size-4 text-muted" label="calculando o total" /> : null}
        </dt>
        <dd
          className={cn(
            'tnum font-display text-[1.75rem] font-semibold leading-none transition-opacity',
            !fresh && 'opacity-45',
          )}
        >
          {quote ? money(quote.totalCents) : '—'}
        </dd>
      </div>
    </dl>
  );
}

// ── a manager's discount: fixed or percent, always with a reason ───────────

const REASONS = ['Cliente da casa', 'Cortesia', 'Erro no pedido', 'Combinado com o cliente'];

export function DiscountSheet({
  open,
  onOpenChange,
  value,
  onApply,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: PdvDiscountIn | null;
  onApply: (d: PdvDiscountIn | null) => void;
  busy?: boolean;
}) {
  const [kind, setKind] = useState<'fixed' | 'percent'>('percent');
  const [fixed, setFixed] = useState<number | null>(null);
  const [pct, setPct] = useState('');
  const [reason, setReason] = useState('');
  const pctId = useId();
  const fixedId = useId();
  const reasonId = useId();
  useEffect(() => {
    if (!open) return;
    setKind(value?.kind ?? 'percent');
    setFixed(value?.kind === 'fixed' ? value.value : null);
    setPct(value?.kind === 'percent' ? String(value.value / 100).replace('.', ',') : '');
    setReason(value?.reason ?? '');
  }, [open, value]);
  const bps = Math.round(Number(pct.replace(',', '.')) * 100);
  const amount = kind === 'fixed' ? (fixed ?? 0) : Number.isFinite(bps) ? bps : 0;
  const ok = amount > 0 && (kind === 'fixed' || amount <= 10000) && reason.trim().length > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Desconto"
      description="O valor final é a loja que calcula. Fica registrado quem deu e por quê."
      footer={
        <div className="flex gap-2">
          {value ? (
            <Button variant="ghost" className="text-danger!" onClick={() => onApply(null)}>
              tirar desconto
            </Button>
          ) : null}
          <Button
            className="flex-1"
            size="lg"
            disabled={!ok}
            loading={!!busy}
            onClick={() => onApply({ kind, value: amount, reason: reason.trim().slice(0, 140) })}
          >
            aplicar desconto
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pb-2">
        <Segmented
          label="tipo de desconto"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'percent', label: 'Porcentagem' },
            { value: 'fixed', label: 'Valor em reais' },
          ]}
        />
        {kind === 'percent' ? (
          <Field label="Quantos por cento" htmlFor={pctId} helper="De 0,01% a 100%.">
            <TextInput
              id={pctId}
              inputMode="decimal"
              value={pct}
              trail="%"
              placeholder="10"
              onChange={(e) => setPct(e.target.value.replace(/[^\d,.]/g, ''))}
              className="tnum"
            />
            <Chips
              label="porcentagens comuns"
              className="mt-2"
              value={pct}
              onChange={setPct}
              options={['5', '10', '15', '20'].map((p) => ({ value: p, label: `${p}%` }))}
            />
          </Field>
        ) : (
          <Field label="Quanto em reais" htmlFor={fixedId}>
            <MoneyField id={fixedId} cents={fixed} min={1} allowEmpty onCommit={setFixed} />
          </Field>
        )}
        <Field label="Motivo" htmlFor={reasonId}>
          <TextInput
            id={reasonId}
            maxLength={140}
            value={reason}
            placeholder="por que esse desconto"
            onChange={(e) => setReason(e.target.value)}
          />
          <Chips
            label="motivos comuns"
            className="mt-2"
            value={reason}
            onChange={setReason}
            options={REASONS.map((r) => ({ value: r, label: r }))}
          />
        </Field>
      </div>
    </Sheet>
  );
}

export const discountLabel = (d: PdvDiscountIn) =>
  d.kind === 'percent'
    ? `${(d.value / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
    : money(d.value);

/** A reason for an irreversible act (cancel, void): chips plus words of their own. */
export function ReasonField({
  value,
  onChange,
  reasons,
  label = 'Motivo',
}: {
  value: string;
  onChange: (v: string) => void;
  reasons: string[];
  label?: string;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <TextInput
        id={id}
        maxLength={140}
        value={value}
        placeholder="conte em poucas palavras"
        onChange={(e) => onChange(e.target.value)}
      />
      <Chips
        label="motivos comuns"
        className="mt-2"
        value={value}
        onChange={onChange}
        options={reasons.map((r) => ({ value: r, label: r }))}
      />
    </Field>
  );
}
