import { useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Ban,
  CalendarPlus,
  ChevronRight,
  Loader2,
  Repeat2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { BillingStore, ControlPlan } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDay, fmtMoney } from '@/lib/format.ts';
import { errorMessage } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Field, Input, Select } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { FEATURES } from './planEdit.tsx';
import { useControlPlans, useStoreBilling, type StoreBillingCall } from './queries.ts';

const NOTE_MAX = 200;
const MONTHS = [
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['6', '6'],
  ['12', '12'],
] as const;
type MonthsOpt = (typeof MONTHS)[number][0];

export const monthsLabel = (n: number) => (n === 1 ? '1 mês' : `${n} meses`);

/** `iso` + n calendar months, on the same day (or the month's last); what Core will land on. */
export function addMonths(iso: string | Date, n: number): string {
  const d = new Date(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.toISOString();
}

// ── shared pieces of the sheets ────────────────────────────────────────────

export type Effect = { text: ReactNode; tone?: 'bad' | undefined } | null | false | undefined | '';

/** What the action does, one line each: the team reads this before money moves. */
export function Effects({ items }: { items: Effect[] }) {
  const shown = items.filter((x): x is { text: ReactNode; tone?: 'bad' } => !!x);
  return (
    <ul className="flex flex-col gap-1.5 rounded-lg border bg-secondary px-3 py-2.5 text-xs">
      {shown.map((e, i) => (
        <li
          key={i}
          className={cn(
            'flex gap-2',
            e.tone === 'bad' ? 'text-destructive-foreground' : 'text-muted-foreground',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'mt-[0.45rem] size-1 shrink-0 rounded-full',
              e.tone === 'bad' ? 'bg-destructive' : 'bg-muted-foreground/60',
            )}
          />
          <span className="min-w-0">{e.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Before → after, the one number or state that changes. */
/** Before → after: the number or state that changes, each side with an optional caption. */
export function FromTo({
  label,
  from,
  to,
  fromHint,
  toHint,
}: {
  label: string;
  from: ReactNode;
  to: ReactNode;
  fromHint?: ReactNode | undefined;
  toHint?: ReactNode | undefined;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-card">
        <span className="flex min-w-0 flex-col">
          {fromHint && <span className="truncate text-xs text-muted-foreground">{fromHint}</span>}
          <span className="truncate text-sm text-muted-foreground line-through decoration-1 tnum">
            {from}
          </span>
        </span>
        <ArrowRight className="size-4 text-muted-foreground" />
        <span className="flex min-w-0 flex-col items-end text-right">
          {toHint && (
            <span className="max-w-full truncate text-xs text-muted-foreground">{toHint}</span>
          )}
          <span className="max-w-full truncate text-sm font-semibold tnum">{to}</span>
        </span>
      </div>
    </div>
  );
}

export function NoteField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field
      label="motivo"
      htmlFor={id}
      hint={
        <span className="flex justify-between gap-2">
          <span>opcional · só a equipe vê</span>
          <span className="tnum">
            {value.length}/{NOTE_MAX}
          </span>
        </span>
      }
    >
      <Input
        id={id}
        value={value}
        maxLength={NOTE_MAX}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ex.: parceria, cortesia de lançamento"
      />
    </Field>
  );
}

/**
 * One action's sheet: the form, what it does, and a confirm that sends one Idempotency-Key for
 * the life of the sheet, so a retry after a lost answer replays instead of giving twice.
 */
export function ActionSheet({
  tenantId,
  title,
  description,
  call,
  confirm,
  destructive,
  done,
  onClose,
  children,
}: {
  tenantId: string;
  title: string;
  description?: ReactNode | undefined;
  /** the request, or null while the form isn't ready */
  call: Omit<StoreBillingCall, 'key'> | null;
  confirm: string;
  destructive?: boolean | undefined;
  /** the toast once Core says yes */
  done: (r: { until?: string | undefined; expiresAt?: string | undefined }) => string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const run = useStoreBilling(tenantId);
  const send = () => {
    if (!call || run.isPending) return;
    run.mutate({ ...call, key } as StoreBillingCall, {
      onSuccess: (r) => {
        toast.success(done(r));
        onClose();
      },
    });
  };
  return (
    <ResponsiveSheet
      open
      onOpenChange={(o) => !o && !run.isPending && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            voltar
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={!call || run.isPending}
            onClick={send}
          >
            {run.isPending && <Loader2 className="animate-spin" />}
            {confirm}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {children}
        {run.isError && (
          <p className="text-xs text-destructive-foreground" role="alert">
            {errorMessage(run.error)}
          </p>
        )}
      </form>
    </ResponsiveSheet>
  );
}

function MonthsField({ value, onChange }: { value: MonthsOpt; onChange: (v: MonthsOpt) => void }) {
  return (
    <Field label="quantos meses">
      <Segmented value={value} onChange={onChange} options={MONTHS} label="quantos meses" />
    </Field>
  );
}

const featureList = (keys: string[]) =>
  FEATURES.filter((f) => keys.includes(f.key))
    .map((f) => f.label)
    .join(', ');

// ── the sheets ──────────────────────────────────────────────────────────────

type Sub = NonNullable<BillingStore['subscription']>;

function PlanSheet({ s, sub, onClose }: { s: BillingStore; sub: Sub; onClose: () => void }) {
  const plans = useControlPlans();
  const [planId, setPlanId] = useState('');
  const [note, setNote] = useState('');
  const all = [...(plans.data ?? [])].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  const current = all.find((p) => p.id === s.plan.id);
  const target = all.find((p) => p.id === planId);
  const on = (p: ControlPlan | undefined) =>
    FEATURES.filter((f) => p?.features?.[f.key]).map((f) => f.key as string);
  const gains = target ? on(target).filter((k) => !on(current).includes(k)) : [];
  const loses = target ? on(current).filter((k) => !on(target).includes(k)) : [];
  const paid = sub.status === 'active' || sub.status === 'past_due';
  const t = target?.name ?? 'novo plano';
  return (
    <ActionSheet
      tenantId={s.tenantId}
      title="trocar o plano"
      description={s.name}
      call={
        target && target.id !== s.plan.id
          ? { action: 'plan', body: { planId: target.id, ...(note.trim() ? { note } : {}) } }
          : null
      }
      confirm={target ? `trocar para ${target.name}` : 'trocar plano'}
      done={() => `${s.name} agora está no ${t}`}
      onClose={onClose}
    >
      <Field label="novo plano" htmlFor="staff-plan">
        <Select id="staff-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="" disabled>
            {plans.isPending ? 'carregando…' : 'escolha um plano'}
          </option>
          {all.map((p) => (
            <option key={p.id} value={p.id} disabled={p.id === s.plan.id}>
              {[
                p.name,
                `${fmtMoney(p.priceCents)}/mês`,
                p.id === s.plan.id ? 'atual' : null,
                !p.available ? 'fechado' : null,
                !p.public ? 'oculto' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </option>
          ))}
        </Select>
      </Field>
      {target && (
        <>
          <FromTo
            label="mensalidade"
            fromHint={s.plan.name}
            from={fmtMoney(current?.priceCents)}
            toHint={target.name}
            to={fmtMoney(target.priceCents)}
          />
          <Effects
            items={[
              { text: 'vale agora, sem cobrar a diferença à parte' },
              paid && {
                text: `a próxima mensalidade${sub.currentPeriodEnd ? `, em ${fmtDay(sub.currentPeriodEnd)},` : ''} já sai no valor do ${t}`,
              },
              sub.status === 'trialing' && {
                text: `o teste continua até ${fmtDay(sub.trialEndsAt ?? sub.currentPeriodEnd)}; a primeira mensalidade sai no valor do ${t}`,
              },
              sub.status === 'pending' && {
                text: `a primeira mensalidade, ainda em aberto, passa para o valor do ${t}`,
              },
              sub.method === 'card' && {
                text: 'o Mercado Pago passa a cobrar o novo valor no cartão',
              },
              gains.length > 0 && { text: `passa a ter: ${featureList(gains)}` },
              loses.length > 0 && { text: `perde na hora: ${featureList(loses)}`, tone: 'bad' },
              (sub.pendingPlanId || sub.upgradePlanId) && {
                text: 'a troca que o lojista tinha pedido em Conta é descartada',
              },
              { text: 'o lojista recebe um aviso no WhatsApp' },
            ]}
          />
          <NoteField id="staff-plan-note" value={note} onChange={setNote} />
        </>
      )}
    </ActionSheet>
  );
}

function ActivateSheet({ s, sub, onClose }: { s: BillingStore; sub: Sub; onClose: () => void }) {
  const plans = useControlPlans();
  const [m, setM] = useState<MonthsOpt>('1');
  const [note, setNote] = useState('');
  const n = Number(m);
  const plan = plans.data?.find((p) => p.id === s.plan.id);
  const trial = sub.status === 'trialing';
  const until = addMonths(new Date(), n);
  return (
    <ActionSheet
      tenantId={s.tenantId}
      title={trial ? 'transformar o teste em plano pago' : 'ativar o plano sem cobrar'}
      description={s.name}
      call={{ action: 'activate', body: { months: n, ...(note.trim() ? { note } : {}) } }}
      confirm={`ativar por ${monthsLabel(n)}`}
      done={(r) => `${s.name}: ${s.plan.name} ativo até ${fmtDay(r.until ?? until)}`}
      onClose={onClose}
    >
      <MonthsField value={m} onChange={setM} />
      <FromTo
        label="situação"
        fromHint={trial ? 'em teste até' : 'loja fechada'}
        from={trial ? fmtDay(sub.trialEndsAt ?? sub.currentPeriodEnd) : 'sem pagamento'}
        toHint="plano pago até"
        to={fmtDay(until)}
      />
      <Effects
        items={[
          {
            text: trial
              ? `o teste acaba agora e a loja fica no ${s.plan.name} como se tivesse pago, sem pagar nada`
              : `a loja abre agora no ${s.plan.name}, sem pagar nada`,
          },
          {
            text: `a primeira mensalidade${plan ? ` (${fmtMoney(plan.priceCents)})` : ''} vence em ${fmtDay(until)}, por Pix; o lojista pode trocar para cartão em Conta`,
          },
          plan?.features?.vendedor && {
            text: `o Duá passa à cota do mês: ${plan.aiConversations.toLocaleString('pt-BR')} conversas`,
          },
          s.openInvoice && { text: `a fatura ${s.openInvoice.number}, em aberto, é anulada` },
          sub.method === 'card' && {
            text: 'o cartão cadastrado no Mercado Pago é desvinculado: ele cobraria na data antiga',
          },
          { text: 'nenhuma fatura é paga: não aparece como pagamento recebido' },
          { text: 'o lojista recebe um aviso no WhatsApp' },
        ]}
      />
      <NoteField id="staff-activate-note" value={note} onChange={setNote} />
    </ActionSheet>
  );
}

function FreeMonthsSheet({ s, sub, onClose }: { s: BillingStore; sub: Sub; onClose: () => void }) {
  const [m, setM] = useState<MonthsOpt>('1');
  const [note, setNote] = useState('');
  const n = Number(m);
  const pix = sub.method === 'pix';
  const owed = s.freeMonthsPending ?? 0;
  const end =
    sub.status === 'trialing' ? (sub.trialEndsAt ?? sub.currentPeriodEnd) : sub.currentPeriodEnd;
  const moves = pix && (sub.status === 'active' || sub.status === 'trialing') && end;
  return (
    <ActionSheet
      tenantId={s.tenantId}
      title="dar meses grátis"
      description={s.name}
      call={{ action: 'free-months', body: { months: n, ...(note.trim() ? { note } : {}) } }}
      confirm={`dar ${monthsLabel(n)}`}
      done={() => `${monthsLabel(n)} grátis para ${s.name}`}
      onClose={onClose}
    >
      <MonthsField value={m} onChange={setM} />
      {moves && (
        <FromTo
          label={sub.status === 'trialing' ? 'teste grátis até' : 'próxima cobrança'}
          from={fmtDay(end)}
          to={fmtDay(addMonths(end, n + owed))}
        />
      )}
      <Effects
        items={[
          moves &&
            sub.status === 'active' && {
              text: 'a próxima mensalidade muda de data; uma fatura já emitida para a data antiga é anulada',
            },
          moves &&
            sub.status === 'trialing' && {
              text: `o teste grátis fica ${monthsLabel(n)} mais longo`,
            },
          !pix &&
            sub.status !== 'pending' && {
              text: `as próximas ${n === 1 ? 'cobrança' : `${n} cobranças`} no cartão ${n === 1 ? 'é devolvida' : 'são devolvidas'} pelo Mercado Pago assim que ${n === 1 ? 'cair' : 'caírem'}`,
            },
          sub.status === 'pending' && { text: 'ficam guardados até o primeiro pagamento' },
          sub.status === 'past_due' && {
            text: 'ficam guardados até a loja pagar a mensalidade em atraso',
          },
          owed > 0 && { text: `a loja já tem ${monthsLabel(owed)} grátis a aplicar` },
          { text: 'o lojista recebe um aviso quando o mês é aplicado' },
        ]}
      />
      <NoteField id="staff-months-note" value={note} onChange={setNote} />
    </ActionSheet>
  );
}

function CancelSheet({ s, sub, onClose }: { s: BillingStore; sub: Sub; onClose: () => void }) {
  const end =
    sub.status === 'trialing' ? (sub.trialEndsAt ?? sub.currentPeriodEnd) : sub.currentPeriodEnd;
  const now = sub.status === 'pending';
  return (
    <ActionSheet
      tenantId={s.tenantId}
      title="cancelar o plano"
      description={s.name}
      call={{ action: 'cancel', body: {} }}
      confirm="cancelar plano"
      destructive
      done={() =>
        now ? `assinatura de ${s.name} cancelada` : `cancelamento de ${s.name} agendado`
      }
      onClose={onClose}
    >
      <Effects
        items={[
          now
            ? { text: 'a assinatura acaba agora e a fatura em aberto é anulada', tone: 'bad' }
            : {
                text:
                  sub.status === 'trialing'
                    ? `o teste segue até ${fmtDay(end)}; depois a loja fecha`
                    : `o plano vale até ${fmtDay(end)}; depois a loja fecha`,
                tone: 'bad',
              },
          !now && { text: 'faturas em aberto para depois disso são anuladas' },
          !now && sub.method === 'card' && { text: 'o Mercado Pago para de cobrar o cartão' },
          {
            text: now
              ? 'o lojista é avisado; para voltar, ele assina de novo em Conta'
              : 'o lojista é avisado e pode desfazer em Conta, ou a equipe aqui',
          },
        ]}
      />
    </ActionSheet>
  );
}

function ResumeSheet({ s, sub, onClose }: { s: BillingStore; sub: Sub; onClose: () => void }) {
  return (
    <ActionSheet
      tenantId={s.tenantId}
      title="desfazer o cancelamento"
      description={s.name}
      call={{ action: 'resume', body: {} }}
      confirm="desfazer cancelamento"
      done={() => `${s.name} volta a renovar`}
      onClose={onClose}
    >
      <Effects
        items={[
          {
            text: `o plano volta a renovar${sub.currentPeriodEnd ? ` em ${fmtDay(sub.currentPeriodEnd)}` : ''}`,
          },
          sub.method === 'card' && { text: 'o Mercado Pago volta a cobrar o cartão' },
        ]}
      />
    </ActionSheet>
  );
}

// ── the list ────────────────────────────────────────────────────────────────

type Kind = 'plan' | 'activate' | 'free-months' | 'cancel' | 'resume';

function Row({
  icon: Icon,
  label,
  hint,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  danger?: boolean | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
    >
      <Icon
        className={cn(
          'size-4 shrink-0',
          danger ? 'text-destructive-foreground' : 'text-muted-foreground',
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('text-sm font-medium', danger && 'text-destructive-foreground')}>
          {label}
        </span>
        <span className="truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" />
    </button>
  );
}

/** What the team can do to one store's plan; each opens a sheet that says what happens first. */
export function StoreBillingActions({ s }: { s: BillingStore }) {
  const [open, setOpen] = useState<Kind | null>(null);
  const sub = s.subscription;
  if (!sub || sub.status === 'cancelled') return null;
  const ending = !!sub.cancelAtPeriodEnd;
  const unpaid = sub.status === 'trialing' || sub.status === 'pending';
  const close = () => setOpen(null);
  const monthsHint =
    sub.status === 'pending' || sub.status === 'past_due'
      ? 'ficam guardados até a loja pagar'
      : sub.method === 'card'
        ? 'devolve as próximas cobranças no cartão'
        : sub.status === 'trialing'
          ? 'alonga o teste grátis'
          : 'adia a próxima cobrança';
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">ações da equipe</h4>
      <div className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-card">
        <Row
          icon={Repeat2}
          label="trocar plano"
          hint="vale agora, sem cobrar a diferença"
          onClick={() => setOpen('plan')}
        />
        {unpaid && !ending && (
          <Row
            icon={BadgeCheck}
            label={sub.status === 'trialing' ? 'transformar em plano pago' : 'ativar sem cobrar'}
            hint={
              sub.status === 'trialing'
                ? 'o plano fica pago, sem cobrar'
                : 'abre a loja sem o primeiro pagamento'
            }
            onClick={() => setOpen('activate')}
          />
        )}
        {!ending && (
          <Row
            icon={CalendarPlus}
            label="dar meses grátis"
            hint={monthsHint}
            onClick={() => setOpen('free-months')}
          />
        )}
        {ending ? (
          <Row
            icon={Undo2}
            label="desfazer cancelamento"
            hint="o plano volta a renovar"
            onClick={() => setOpen('resume')}
          />
        ) : (
          <Row
            icon={Ban}
            label="cancelar plano"
            hint={sub.status === 'pending' ? 'acaba agora' : 'vale até o fim do período'}
            danger
            onClick={() => setOpen('cancel')}
          />
        )}
      </div>
      {open === 'plan' && <PlanSheet s={s} sub={sub} onClose={close} />}
      {open === 'activate' && <ActivateSheet s={s} sub={sub} onClose={close} />}
      {open === 'free-months' && <FreeMonthsSheet s={s} sub={sub} onClose={close} />}
      {open === 'cancel' && <CancelSheet s={s} sub={sub} onClose={close} />}
      {open === 'resume' && <ResumeSheet s={s} sub={sub} onClose={close} />}
    </div>
  );
}
