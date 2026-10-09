import {
  ArrowRight,
  CalendarStar,
  Check,
  CheckCircle,
  Clock,
  Coins,
  Lock,
  MagicWand,
  Package,
  PaintBrush,
  Pause,
  Play,
  Storefront,
  Tag,
  Ticket,
  WarningCircle,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import type { CopilotAction, CopilotActionKind } from '../../lib/api.ts';
import { Button } from '../Button.tsx';
import { cn } from '../cn.ts';

const KIND_ICON: Record<CopilotActionKind, Icon> = {
  'store.pause': Pause,
  'store.resume': Play,
  'store.operations': Storefront,
  'store.special_day': CalendarStar,
  'product.update': Package,
  'products.price': Tag,
  'coupon.create': Ticket,
  'coupon.update': Ticket,
  'site.build': MagicWand,
  'site.revise': PaintBrush,
};

// what confirming means, where it's more than "this change happens"
const CONFIRM_NOTE: Partial<Record<CopilotActionKind, string>> = {
  'site.build':
    'Confirmar aprova este briefing. É a sua única aprovação: o site fica pronto em até 1 dia.',
  'site.revise': 'Confirmar usa o ajuste incluído. Ele fica pronto em até 1 dia.',
};
// who may confirm, when a manager can't
const OWNER_ONLY: ReadonlySet<CopilotActionKind> = new Set(['site.build', 'site.revise']);

/** "#7a2e3b · #f3e6d8": the colours themselves, beside their codes */
const HEXES = /^#[0-9a-f]{6}(?: · #[0-9a-f]{6})*$/i;
function Value({ text, struck }: { text: string; struck?: boolean }) {
  if (!HEXES.test(text)) return <>{text}</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {text.split(' · ').map((h) => (
        <span key={h} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-full ring-1 ring-inset ring-line-strong"
            style={{ background: h }}
          />
          <span className={cn(struck && 'line-through decoration-1')}>{h}</span>
        </span>
      ))}
    </span>
  );
}

const CHIP =
  'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[0.8125rem] font-semibold leading-[1.125rem]';

/**
 * A change Duá prepared in the Copilot (ADR 0034): what it is, Core's diff line by line (label ·
 * before struck → after), a chip when it touches money, and the decision. Nothing changes until
 * "confirmar"; once decided the card keeps what happened: done (with "ver"), set aside, expired
 * or refused by the store, in Core's words.
 */
export function ActionCard({
  action: a,
  onConfirm,
  onDecline,
  busy,
  className,
}: {
  action: CopilotAction;
  onConfirm?: (() => void) | undefined;
  onDecline?: (() => void) | undefined;
  /** the decision in flight on this card */
  busy?: 'confirm' | 'decline' | null | undefined;
  className?: string | undefined;
}) {
  const I = KIND_ICON[a.kind] ?? Storefront;
  const open = a.status === 'proposed';
  const deciding = open && a.canDecide && (onConfirm || onDecline);
  const quiet = a.status === 'declined' || a.status === 'expired';
  return (
    <article
      aria-label={`proposta do Duá: ${a.title}`}
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-lg',
        quiet
          ? 'bg-bg ring-1 ring-inset ring-line-strong'
          : cn(
              'bg-surface noite:bg-raised',
              deciding ? 'ring-2 ring-spark depth-2' : 'ring-1 ring-inset ring-line-strong depth-1',
            ),
        className,
      )}
    >
      <header className="flex items-start gap-3 px-4 pb-2 pt-3.5">
        <span
          aria-hidden
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full',
            quiet ? 'bg-sunken text-muted' : 'bg-spark-soft text-ink',
          )}
        >
          <I weight="bold" className="size-[18px]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 pt-1">
          <p className={cn('text-[0.9375rem] font-semibold leading-5', quiet && 'text-muted')}>
            {a.title}
          </p>
          {a.money ? (
            <span
              className={cn(CHIP, quiet ? 'bg-sunken text-muted' : 'bg-warning-soft text-warning')}
            >
              <Coins weight="bold" className="size-[15px] shrink-0" aria-hidden />
              {a.kind.startsWith('coupon.') ? 'mexe em desconto' : 'mexe em preço'}
            </span>
          ) : null}
        </div>
      </header>

      {a.lines.length ? (
        <dl className="mx-4 mb-1 divide-y divide-line">
          {a.lines.map((l, i) => (
            <div key={i} className="flex flex-col gap-0.5 py-2">
              <dt className="t-caption text-muted">{l.label}</dt>
              <dd className="tnum flex flex-wrap items-baseline gap-x-2 gap-y-0.5 [overflow-wrap:anywhere]">
                {l.from !== null ? (
                  <>
                    <del className="t-body text-muted decoration-1">
                      <span className="sr-only">de </span>
                      <Value text={l.from} struck />
                    </del>
                    <ArrowRight
                      weight="bold"
                      className="size-3.5 shrink-0 self-center text-faint"
                      aria-hidden
                    />
                  </>
                ) : null}
                <ins
                  className={cn(
                    't-body no-underline',
                    quiet ? 'text-muted' : 'font-semibold text-ink',
                  )}
                >
                  {l.from !== null ? <span className="sr-only">para </span> : null}
                  <Value text={l.to} />
                </ins>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <Outcome
        a={a}
        deciding={!!deciding}
        onConfirm={onConfirm}
        onDecline={onDecline}
        busy={busy}
      />
    </article>
  );
}

function Outcome({
  a,
  deciding,
  onConfirm,
  onDecline,
  busy,
}: {
  a: CopilotAction;
  deciding: boolean;
  onConfirm?: (() => void) | undefined;
  onDecline?: (() => void) | undefined;
  busy?: 'confirm' | 'decline' | null | undefined;
}) {
  if (a.status === 'proposed' && deciding)
    return (
      <footer className="flex flex-col gap-2 border-t border-line px-4 pb-3.5 pt-3">
        <div className="flex flex-wrap gap-2">
          {onConfirm ? (
            <Button
              icon={<Check weight="bold" />}
              loading={busy === 'confirm'}
              disabled={busy === 'decline'}
              onClick={onConfirm}
            >
              confirmar
            </Button>
          ) : null}
          {onDecline ? (
            <Button
              variant="ghost"
              loading={busy === 'decline'}
              disabled={busy === 'confirm'}
              onClick={onDecline}
            >
              agora não
            </Button>
          ) : null}
        </div>
        <p className="t-caption text-muted">
          {CONFIRM_NOTE[a.kind] ?? 'Nada muda até você confirmar.'}
        </p>
      </footer>
    );
  if (a.status === 'proposed')
    return (
      <Band tone="muted" Icon={Lock}>
        {OWNER_ONLY.has(a.kind)
          ? 'Só o dono da loja confirma isso.'
          : 'Só o dono ou um gerente confirma isso.'}
      </Band>
    );
  if (a.status === 'applied')
    return (
      <Band
        tone="success"
        Icon={CheckCircle}
        action={
          a.link ? (
            <Link
              to={a.link}
              className="relative -my-2 inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md px-2 font-semibold underline underline-offset-2 hover:bg-hover"
            >
              ver
              <ArrowRight weight="bold" className="size-4" aria-hidden />
            </Link>
          ) : null
        }
      >
        {a.done ?? 'Feito.'}
      </Band>
    );
  if (a.status === 'failed')
    return (
      <Band tone="danger" Icon={WarningCircle}>
        {a.error ?? 'A loja não aceitou essa mudança.'}
      </Band>
    );
  if (a.status === 'expired')
    return (
      <Band tone="muted" Icon={Clock}>
        Esta proposta expirou. Se ainda quiser, peça de novo.
      </Band>
    );
  return (
    <Band tone="muted" Icon={XCircle}>
      Deixado de lado
    </Band>
  );
}

function Band({
  tone,
  Icon: I,
  children,
  action,
}: {
  tone: 'success' | 'danger' | 'muted';
  Icon: Icon;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <footer
      className={cn(
        't-body flex items-start gap-2 px-4 py-3',
        tone === 'success' && 'bg-success-soft font-semibold text-success',
        tone === 'danger' && 'bg-danger-soft font-semibold text-danger',
        tone === 'muted' && 'border-t border-line text-muted',
      )}
    >
      <I weight="bold" className="mt-0.5 size-[18px] shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </footer>
  );
}
