import { Check, Info, ShieldCheck, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { SummaryCardData } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { cn } from '../cn.ts';
import { PAPER } from './tones.ts';

/**
 * What Duá did, in one past-tense line between bubbles ("anotou 2 itens na sacola",
 * "entrega: R$ 7,00 · ~40 min"), with "por quê" beside it (sales-agent-ux §3.3).
 */
export function ActionReceipt({
  children,
  icon: I = Check,
  onWhy,
  className,
}: {
  children: ReactNode;
  icon?: Icon | undefined;
  /** opens the "por quê" sheet for this turn */
  onWhy?: (() => void) | undefined;
  className?: string | undefined;
}) {
  return (
    <p
      className={cn(
        'my-0.5 inline-flex min-h-8 max-w-[94%] items-center gap-1.5 self-center rounded-full bg-bg px-3 py-1 text-[0.8125rem] font-medium leading-[1.0625rem] text-muted ring-1 ring-inset ring-line',
        className,
      )}
    >
      <I weight="bold" className="size-3.5 shrink-0 text-success" aria-hidden />
      <span className="min-w-0 truncate">{children}</span>
      {onWhy ? (
        <button
          type="button"
          onClick={onWhy}
          className="relative shrink-0 font-semibold text-ink underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']"
        >
          por quê
        </button>
      ) : null}
    </p>
  );
}

/** "calculado pela loja", with its shield: the words of the guarantee, the same everywhere */
export function CoreMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-[0.75rem] font-medium', className)}>
      <ShieldCheck weight="bold" className="size-3.5 shrink-0" aria-hidden />
      calculado pela loja
    </span>
  );
}

/**
 * Core's receipt (sales-agent-ux §1.2): paper with a dashed tear, the lines, fee and discount,
 * the total, when it arrives, and "calculado pela loja". Every figure is Core's; the client
 * formats and never adds. A table to screen readers. A long sacola shows its first lines and
 * "+ N itens".
 */
export function CoreReceipt({
  data,
  title = 'Seu pedido',
  maxLines = 6,
  footer,
  align = 'end',
  className,
}: {
  data: SummaryCardData;
  title?: string | undefined;
  maxLines?: number | undefined;
  /** under the total: "ver o pedido #1284" */
  footer?: ReactNode | undefined;
  align?: 'start' | 'end' | 'stretch' | undefined;
  className?: string | undefined;
}) {
  const shown = data.lines.slice(0, maxLines);
  const hidden = data.lines.length - shown.length;
  const deliveryLabel =
    data.mode === 'delivery' ? `Entrega${data.address ? ` · ${data.address}` : ''}` : 'Retirada';
  const extra: { label: string; cents: number }[] = [];
  if (data.mode === 'delivery' || data.feeCents)
    extra.push({ label: deliveryLabel, cents: data.feeCents });
  if (data.discountCents)
    extra.push({ label: data.discountLabel ?? 'Desconto', cents: -data.discountCents });
  if (data.adjustmentCents)
    extra.push({
      label: data.adjustmentCents > 0 ? 'Taxa do pagamento' : 'Desconto do pagamento',
      cents: data.adjustmentCents,
    });
  const meta = [
    data.eta ? `chega em ${data.eta}` : null,
    data.payment ? `pagamento: ${data.payment}` : null,
    data.changeForCents ? `troco para ${money(data.changeForCents)}` : null,
  ].filter(Boolean);
  return (
    <figure
      className={cn(
        'relative m-0 w-[min(88%,24rem)] rounded-[14px] px-3.5 pb-2.5 pt-3',
        PAPER,
        align === 'end' && 'self-end',
        align === 'start' && 'self-start',
        align === 'stretch' && 'w-full',
        // the tear: a dashed edge across the top of the paper
        'before:absolute before:inset-x-3 before:top-0 before:border-t-2 before:border-dashed before:border-line-strong before:content-[""]',
        className,
      )}
    >
      <figcaption className="flex items-center justify-between gap-2 pt-0.5 text-muted">
        <span className="text-[0.6875rem] font-semibold uppercase leading-4 tracking-[0.08em]">
          {title}
        </span>
        <CoreMark />
      </figcaption>
      {data.test ? (
        <p className="t-caption mt-2 flex items-start gap-1.5 rounded-sm bg-info-soft px-2.5 py-1.5 font-semibold text-info">
          <Info weight="bold" className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          pedido de teste · não vai para a cozinha
        </p>
      ) : null}
      <table className="mt-1.5 w-full border-collapse text-[0.875rem] leading-5">
        <caption className="sr-only">
          {title}, calculado pela loja: total {money(data.totalCents)}
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">item</th>
            <th scope="col">valor</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((l, i) => (
            <tr key={i}>
              <td className="py-[3px] pr-3 align-top [overflow-wrap:anywhere]">{l.text}</td>
              <td className="tnum whitespace-nowrap py-[3px] text-right align-top font-display font-medium">
                {money(l.totalCents)}
              </td>
            </tr>
          ))}
          {hidden > 0 ? (
            <tr>
              <td colSpan={2} className="py-[3px] text-muted">
                + {hidden} {hidden === 1 ? 'item' : 'itens'}
              </td>
            </tr>
          ) : null}
          {extra.map((x) => (
            <tr key={x.label}>
              <td className="py-[3px] pr-3 align-top [overflow-wrap:anywhere]">{x.label}</td>
              <td className="tnum whitespace-nowrap py-[3px] text-right align-top font-display font-medium">
                {x.cents < 0 ? `− ${money(-x.cents)}` : money(x.cents)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <th scope="row" className="pt-1.5 text-left font-bold">
              Total
            </th>
            <td className="tnum whitespace-nowrap pt-1.5 text-right font-display text-[1rem] font-bold">
              {money(data.totalCents)}
            </td>
          </tr>
        </tfoot>
      </table>
      {meta.length || data.test ? (
        <p className="t-caption mt-1 text-muted">
          {[...meta, data.test ? 'nada foi cobrado' : null].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      {footer ? <div className="mt-2">{footer}</div> : null}
    </figure>
  );
}
