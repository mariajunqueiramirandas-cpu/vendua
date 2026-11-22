import {
  ArrowRight,
  BellRinging,
  Check,
  Clock,
  CreditCard,
  DeviceMobile,
  ForkKnife,
  Megaphone,
  Motorcycle,
  PixLogo,
  Storefront,
  WhatsappLogo,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type ChecklistItem } from '../../lib/api.ts';
import { qk } from '../../lib/query.ts';
import { can, useSession } from '../../lib/session.ts';
import { platform } from '../../platform/index.ts';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { Spinner } from '../../ui/Spinner.tsx';
import { useDeviceStep } from '../home/DeviceCard.tsx';

// Everything a new store still has to do, in one list, wherever it's shown (Início, the
// onboarding's finale): what it takes to open, what keeps an order from being missed (this
// device ringing, the store's own WhatsApp, card on the site) and the first order. Core's
// checklist is the first group; the rest is read here. A finished group folds into one line.

interface Row {
  id: string;
  label: string;
  line?: string | undefined;
  done: boolean;
  Icon: Icon;
  to?: string;
  run?: () => void;
  busy?: boolean;
}

const CORE: Record<string, { Icon: Icon; line: string }> = {
  profile: { Icon: Storefront, line: 'O cliente reconhece a loja e fala com você.' },
  hours: { Icon: Clock, line: 'O site mostra se a loja está aberta agora.' },
  delivery: { Icon: Motorcycle, line: 'Retirada, entrega e quanto custa.' },
  pix: { Icon: PixLogo, line: 'O dinheiro cai direto na sua conta.' },
  menu: { Icon: ForkKnife, line: 'Foto é o que faz o cliente pedir.' },
  first_order: { Icon: Megaphone, line: 'Mande o link para os clientes.' },
};

/** Where an item of Core's checklist is answered: the onboarding screen that asks it. */
function linkOf(c: ChecklistItem, hasLogo: boolean): string {
  switch (c.id) {
    case 'profile':
      return `/bem-vindo?passo=${hasLogo ? 'atendimento' : 'cara'}`;
    case 'hours':
    case 'delivery':
      return '/bem-vindo?passo=atendimento';
    case 'pix':
      return '/bem-vindo?passo=pagamento';
    case 'menu':
      return '/cardapio';
    case 'first_order':
      return '/marketing/divulgar';
    default:
      return c.href;
  }
}

export function useSetupRows(checklist: ChecklistItem[]) {
  const s = useSession();
  const owner = can(s.user.role, 'owner');
  const manager = can(s.user.role, 'manager');
  const wa = useQuery({ queryKey: qk.whatsapp, queryFn: api.whatsapp, enabled: manager });
  const store = useQuery({ queryKey: qk.store, queryFn: api.store, enabled: manager });
  const hasLogo = !!store.data?.profile.logoUrl;
  const hasWhatsapp = !!store.data?.profile.whatsapp;
  const pay = useQuery({ queryKey: qk.payments, queryFn: api.payments, enabled: owner });
  const device = useDeviceStep();

  const core = (c: ChecklistItem): Row => ({
    id: c.id,
    // "logo e WhatsApp": named by whichever of the two is still missing
    label:
      c.id === 'profile' && !c.done && store.data
        ? hasLogo
          ? 'WhatsApp da loja'
          : hasWhatsapp
            ? 'Foto ou logo da loja'
            : c.label
        : c.label,
    line:
      c.id === 'profile' && hasWhatsapp && !hasLogo
        ? 'A foto vira o ícone da loja.'
        : CORE[c.id]?.line,
    done: c.done,
    Icon: CORE[c.id]?.Icon ?? Check,
    to: linkOf(c, hasLogo),
  });
  const open = checklist.filter((c) => c.id !== 'first_order' && (c.id !== 'pix' || owner));
  const orders: Row[] = [
    ...(device.step
      ? [
          {
            id: 'device',
            label:
              device.step === 'install' ? 'Instalar o app no celular' : 'Ligar os avisos de pedido',
            line:
              device.step === 'install'
                ? 'Abre num toque e toca quando chega pedido.'
                : 'Toca e vibra mesmo com o app fechado.',
            done: false,
            Icon: device.step === 'install' ? DeviceMobile : BellRinging,
            run: () => void device.run(),
            busy: device.busy,
          },
        ]
      : []),
    ...(wa.data?.available
      ? [
          {
            id: 'whatsapp',
            label: 'Conectar o WhatsApp da loja',
            line: 'O cliente recebe cada passo do pedido no WhatsApp.',
            done: wa.data.state === 'open',
            Icon: WhatsappLogo,
            to: '/whatsapp',
          },
        ]
      : []),
    ...(owner && platform.canPay && pay.data?.mercadoPago.available
      ? [
          {
            id: 'mp',
            label: 'Receber cartão pelo site',
            line: 'Conecte o Mercado Pago: o pedido já chega pago.',
            done: pay.data.mercadoPago.status === 'connected',
            Icon: CreditCard,
            to: '/bem-vindo?passo=pagamento',
          },
        ]
      : []),
  ];
  const first = checklist.filter((c) => c.id === 'first_order').map(core);
  const groups = [
    { id: 'abrir', title: 'Para abrir a loja', rows: open.map(core) },
    { id: 'pedidos', title: 'Para não perder pedidos', rows: orders },
    { id: 'primeiro', title: 'O primeiro pedido', rows: first },
  ].filter((g) => g.rows.length);
  const all = groups.flatMap((g) => g.rows);
  return { groups, done: all.filter((r) => r.done).length, total: all.length, sheet: device.sheet };
}

export function SetupCard({
  checklist,
  title = 'Deixe sua loja pronta',
  className,
}: {
  checklist: ChecklistItem[];
  title?: string;
  className?: string;
}) {
  const { groups, done, total, sheet } = useSetupRows(checklist);
  if (!total) return null;
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <Card as="section" className={cn('p-5', className)} aria-label={title}>
      <div className="flex items-center gap-4">
        <svg
          viewBox="0 0 56 56"
          className="size-14 shrink-0 -rotate-90"
          role="img"
          aria-label={`${done} de ${total} prontos`}
        >
          <circle
            cx="28"
            cy="28"
            r={r}
            fill="none"
            stroke="var(--surface-sunken)"
            strokeWidth="6"
          />
          <circle
            cx="28"
            cy="28"
            r={r}
            fill="none"
            stroke="var(--chart)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(done / total) * c} ${c}`}
            className="transition-[stroke-dasharray] duration-700"
          />
        </svg>
        <div className="min-w-0">
          <h2 className="t-title-2">{title}</h2>
          <p className="t-body tnum text-muted">
            {done} de {total} prontos
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        {groups.map((g) => {
          const left = g.rows.filter((x) => !x.done);
          if (!left.length)
            return (
              <p
                key={g.id}
                className="t-body flex min-h-11 items-center gap-3 rounded-md bg-success-soft px-3 text-success"
              >
                <Check weight="bold" className="size-5 shrink-0" aria-hidden />
                <span>
                  <strong className="font-semibold">{g.title}</strong>: tudo certo
                </span>
              </p>
            );
          return (
            <div key={g.id}>
              <p className="t-caption mb-1 font-semibold uppercase tracking-[0.06em] text-muted">
                {g.title}
              </p>
              <ul className="-mx-2">
                {[...left, ...g.rows.filter((x) => x.done)].map((x) => (
                  <li key={x.id}>
                    <SetupRow row={x} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {sheet}
    </Card>
  );
}

function SetupRow({ row }: { row: Row }) {
  const inner = (
    <>
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full',
          row.done ? 'bg-success-soft text-success' : 'bg-spark-soft text-ink',
        )}
      >
        {row.done ? (
          <Check weight="bold" className="size-5" aria-label="pronto" />
        ) : (
          <row.Icon weight="duotone" className="size-5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block font-semibold',
            row.done && 'font-normal text-muted line-through decoration-line-strong',
          )}
        >
          {row.label}
        </span>
        {row.line && !row.done ? (
          <span className="t-caption block text-muted">{row.line}</span>
        ) : null}
      </span>
      {row.done ? null : row.busy ? (
        <Spinner className="size-5 shrink-0" />
      ) : (
        <ArrowRight className="size-5 shrink-0 text-faint" aria-hidden />
      )}
    </>
  );
  const cls = cn(
    'press-row flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-2 text-left',
    !row.done && 'hover:bg-hover',
  );
  if (row.done) return <div className={cls}>{inner}</div>;
  if (row.run)
    return (
      <button type="button" className={cls} onClick={row.run} disabled={row.busy}>
        {inner}
      </button>
    );
  return (
    <Link to={row.to!} className={cls}>
      {inner}
    </Link>
  );
}
