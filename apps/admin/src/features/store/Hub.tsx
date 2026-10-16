import {
  ArrowSquareOut,
  CalendarBlank,
  Clock,
  Compass,
  Copy,
  Globe,
  IdentificationBadge,
  IdentificationCard,
  MagnifyingGlass,
  Moped,
  PaintBrush,
  Printer,
  Timer,
  UsersThree,
  Wallet,
  WhatsappLogo,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { todayHours } from '@vendua/kernel/rules';
import {
  api,
  type Account,
  type Member,
  type Payments,
  type Printers,
  type StoreView,
  type Whatsapp,
} from '../../lib/api.ts';
import { dateShort, hhmm, money, phone, plural } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { can, featureOpen, useSession } from '../../lib/session.ts';
import { areaOf, NAV } from '../../app/nav.ts';
import { findScreens } from '../../app/screens.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { copyText } from '../../ui/CopyValue.tsx';
import { ErrorState } from '../../ui/feedback.tsx';
import { TextInput } from '../../ui/fields.tsx';
import { LinkList, LinkRow } from '../../ui/LinkRow.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { METHOD_LABEL } from '../../ui/PaymentChip.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { BillingHoldNotice } from './BillingHold.tsx';
import { StatusPill, useStoreQuery } from './StatusPill.tsx';
import { mediaUrl } from '../../lib/media.ts';

// Loja is where every setting of the store lives, so "where do I change X?" has one answer. Each
// part is its own screen (back to here), and each row says what's set there now, so the merchant
// sees the whole store before opening any of it. A row that keeps the store from selling, or
// from telling its customers, says why in warning colour.

type Line = { text: string; warn?: boolean };

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
const list = (xs: string[]) =>
  xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}` : (xs[0] ?? '');

function hoursLine(s: StoreView): Line {
  if (!s.hours.windows.length)
    return { text: 'Sem horário: a loja só abre quando você abrir', warn: true };
  const t = todayHours({ ...s.hours, specialDays: s.specialDaysAhead ?? s.specialDays });
  const ranges = t.windows.map((w) => `${hhmm(w.open)} às ${hhmm(w.close)}`).join(', ');
  const why = t.special ? ` (${t.special.label ?? 'dia especial'})` : '';
  return { text: `Hoje: ${t.closed ? 'fechada' : ranges}${why}` };
}

function deliveryLine(s: StoreView): Line {
  const o = s.operations;
  if (!o.pickupEnabled && !o.deliveryEnabled)
    return { text: 'Retirada e entrega desligadas: ninguém consegue pedir', warn: true };
  const parts: string[] = [];
  if (o.deliveryEnabled) {
    const areas = s.zones.filter((z) => z.active).length;
    if (s.distancePricing.enabled)
      parts.push(`entrega até ${s.distancePricing.maxKm.toLocaleString('pt-BR')} km`);
    else if (areas) parts.push(`entrega em ${plural(areas, 'área', 'áreas')}`);
    else return { text: 'Entrega ligada, mas sem nenhuma área', warn: true };
  }
  if (o.pickupEnabled) parts.push('retirada');
  const min = o.deliveryEnabled ? o.minOrderCents : o.pickupMinOrderCents;
  if (min) parts.push(`mínimo ${money(min)}`);
  return { text: cap(parts.join(' · ')) };
}

function paceLine(s: StoreView): Line {
  const o = s.operations;
  const base = `Preparo de ~${o.prepTimeMinutes} min · aceite em até ${o.acceptTargetMinutes} min`;
  return { text: o.demand === 'high' ? `${base} · muitos pedidos agora` : base };
}

function encomendasLine(s: StoreView): Line {
  const p = s.preorder;
  const parts = [`até ${plural(p.maxDays, 'dia', 'dias')} à frente`];
  if (p.capacity?.days?.some((d) => d !== null)) parts.push('limite por dia');
  if (s.sinal.bps) parts.push(`sinal de ${s.sinal.bps / 100}%`);
  return { text: cap(parts.join(' · ')) };
}

function profileLine(s: StoreView): Line {
  const p = s.profile;
  const missing = [
    !p.logoUrl && 'logo',
    !p.whatsapp && 'WhatsApp',
    !p.address && 'endereço',
  ].filter((x): x is string => !!x);
  if (missing.length) return { text: `Falta ${list(missing)}`, warn: true };
  return { text: [p.name, p.city].filter(Boolean).join(' · ') };
}

function paymentsLine(p: Payments | undefined): Line {
  if (!p) return { text: 'Pix, cartão e dinheiro' };
  const live = p.mercadoPago.status === 'connected' || p.mercadoPago.status === 'expiring';
  if (p.methods.includes('pix') && !p.pix && !live)
    return { text: 'Falta a chave Pix para receber', warn: true };
  if (p.mercadoPago.status === 'disconnected')
    return { text: 'O Mercado Pago desconectou', warn: true };
  if (p.mercadoPago.status === 'restricted')
    return { text: 'O Mercado Pago limitou a conta', warn: true };
  const names = p.methods.map((m) => METHOD_LABEL[m].toLocaleLowerCase('pt-BR'));
  return { text: cap(list(names)).replace(/\bpix\b/g, 'Pix') };
}

function whatsappLine(w: Whatsapp | undefined): Line {
  if (!w) return { text: 'Um aviso ao cliente a cada passo do pedido' };
  if (w.state === 'open') return { text: w.phone ? `Conectado: ${phone(w.phone)}` : 'Conectado' };
  if (w.state === 'logged_out' || w.state === 'banned' || w.state === 'error')
    return { text: 'Desconectou: os clientes não recebem os avisos', warn: true };
  if (w.state === 'connecting' || w.state === 'pairing') return { text: 'Conectando…' };
  return { text: 'Não conectado: conecte para avisar o cliente a cada passo' };
}

function printersLine(p: Printers | undefined): Line {
  if (!p) return { text: 'A comanda impressa na cozinha' };
  if (!p.devices.length) return { text: 'Nenhum aparelho conectado' };
  const off = p.devices.filter((d) => !d.online).length;
  const printers = p.devices.reduce((n, d) => n + d.printers.length, 0);
  if (off)
    return {
      text: `${plural(off, 'aparelho desligado', 'aparelhos desligados')}: a comanda não sai`,
      warn: true,
    };
  return {
    text: printers ? plural(printers, 'impressora', 'impressoras') : 'Aparelho sem impressora',
  };
}

function teamLine(m: Member[] | undefined): Line {
  if (!m) return { text: 'Quem ajuda a tocar a loja' };
  const active = m.filter((x) => x.status === 'active');
  const waiting = active.filter((x) => !x.lastSeenAt && x.inviteSentAt).length;
  const base = plural(active.length, 'pessoa', 'pessoas');
  return {
    text: waiting ? `${base} · ${plural(waiting, 'convite', 'convites')} sem resposta` : base,
  };
}

function accountLine(a: Account | undefined): Line {
  if (!a) return { text: 'O plano e as faturas' };
  const sub = a.subscription;
  if (sub?.status === 'past_due')
    return { text: 'Fatura em aberto: pague para não pausar', warn: true };
  if (sub?.status === 'trialing' && sub.trialEndsAt)
    return { text: `${a.plan.name} · teste até ${dateShort(sub.trialEndsAt)}` };
  if (sub?.cancelAtPeriodEnd && sub.currentPeriodEnd)
    return { text: `${a.plan.name} · termina em ${dateShort(sub.currentPeriodEnd)}` };
  return { text: a.plan.name };
}

interface Row {
  to: string;
  Icon: Icon;
  title: string;
  line: Line;
}

interface Group {
  id: string;
  title: string;
  hint: string;
  rows: Row[];
}

export default function StoreHub() {
  const session = useSession();
  const owner = can(session.user.role, 'owner');
  const printing = featureOpen(session, 'printing');
  const { data: s, error, refetch } = useStoreQuery();
  // each row's line comes from its own screen's data, which then opens already loaded
  const pay = useQuery({ queryKey: qk.payments, queryFn: api.payments });
  const wa = useQuery({ queryKey: qk.whatsapp, queryFn: api.whatsapp });
  const prn = useQuery({ queryKey: qk.printers, queryFn: api.printers, enabled: printing });
  const team = useQuery({ queryKey: qk.team, queryFn: api.team });
  const acc = useQuery({ queryKey: qk.account, queryFn: api.account, enabled: owner });
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());

  const groups = (st: StoreView): Group[] => [
    {
      id: 'vende',
      title: 'Como a loja vende',
      hint: 'Quando atende, como entrega, em quanto tempo e como recebe.',
      rows: [
        { to: '/loja/horarios', Icon: Clock, title: 'Horários', line: hoursLine(st) },
        {
          to: '/loja/entrega',
          Icon: Moped,
          title: 'Entrega e retirada',
          line: deliveryLine(st),
        },
        { to: '/loja/preparo', Icon: Timer, title: 'Tempo de preparo', line: paceLine(st) },
        {
          to: '/loja/encomendas',
          Icon: CalendarBlank,
          title: 'Encomendas',
          line: encomendasLine(st),
        },
        {
          to: '/loja/pagamentos',
          Icon: Wallet,
          title: 'Formas de pagamento',
          line: paymentsLine(pay.data),
        },
      ],
    },
    {
      id: 'aparece',
      title: 'Como a loja aparece',
      hint: 'O que o cliente vê ao abrir o link.',
      rows: [
        {
          to: '/loja/perfil',
          Icon: IdentificationBadge,
          title: 'Perfil da loja',
          line: profileLine(st),
        },
        {
          to: '/aparencia',
          Icon: PaintBrush,
          title: 'Aparência',
          line: { text: 'A página, as cores e as fotos da loja' },
        },
        { to: '/loja/site', Icon: Globe, title: 'Site e endereço', line: { text: hostOf(st.url) } },
      ],
    },
    {
      id: 'avisos',
      title: 'Mensagens e impressão',
      hint: 'Os avisos ao cliente pelo WhatsApp e a comanda na cozinha.',
      rows: [
        {
          to: '/whatsapp',
          Icon: WhatsappLogo,
          title: 'WhatsApp da loja',
          line: whatsappLine(wa.data),
        },
        {
          to: '/impressoras',
          Icon: Printer,
          title: 'Impressoras',
          line: printing ? printersLine(prn.data) : { text: 'Fora do seu plano' },
        },
      ],
    },
    {
      id: 'conta',
      title: 'Equipe e conta',
      hint: 'Quem usa o painel, e o plano da loja.',
      rows: [
        { to: '/equipe', Icon: UsersThree, title: 'Equipe', line: teamLine(team.data?.members) },
        ...(owner
          ? [
              {
                to: '/conta',
                Icon: IdentificationCard,
                title: 'Conta e plano',
                line: accountLine(acc.data),
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <PageBody wide>
      <PageHeader
        title="Loja"
        subtitle="Tudo o que você ajusta na loja, num lugar só."
        actions={<StatusPill />}
      />
      {error && !s ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : !s ? (
        <RowsSkeleton rows={6} />
      ) : (
        <div className="space-y-8">
          {s.status.billingHold ? <BillingHoldNotice /> : null}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-8">
            <Identity s={s} />
            <TextInput
              type="search"
              aria-label="buscar um ajuste"
              placeholder="Buscar um ajuste: frete, pix, horário…"
              lead={<MagnifyingGlass className="size-5" />}
              value={q}
              maxLength={60}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {query ? (
            <Found q={query} groups={groups(s)} />
          ) : (
            <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
              {groups(s).map((g) => (
                <Section key={g.id} id={g.id} title={g.title} hint={g.hint}>
                  <LinkList label={g.title}>
                    {g.rows.map((r) => (
                      <LinkRow
                        key={r.to}
                        to={r.to}
                        Icon={r.Icon}
                        title={r.title}
                        line={r.line.text}
                        {...(r.line.warn ? { warn: true } : {})}
                      />
                    ))}
                  </LinkList>
                </Section>
              ))}
            </div>
          )}
        </div>
      )}
    </PageBody>
  );
}

/** The search's answer: the store's settings first, then any other screen that matches. */
function Found({ q, groups }: { q: string; groups: Group[] }) {
  const session = useSession();
  const rows = new Map(groups.flatMap((g) => g.rows.map((r) => [r.to, r] as const)));
  const hits = findScreens(q, (e) => can(session.user.role, e.min), 12).sort(
    (a, b) => Number(rows.has(b.to)) - Number(rows.has(a.to)),
  );
  if (!hits.length)
    return (
      <Card className="p-5">
        <p className="font-semibold">Nada com “{q}”</p>
        <p className="t-body mt-1 text-muted">
          Tente outra palavra, como frete, pix, horário, logo ou impressora.
        </p>
      </Card>
    );
  return (
    <Section title={plural(hits.length, 'resultado', 'resultados')}>
      <LinkList label="resultados">
        {hits.map((e) => {
          const r = rows.get(e.to);
          return (
            <LinkRow
              key={e.to}
              to={e.to}
              Icon={r?.Icon ?? iconOf(e.to)}
              title={r?.title ?? e.label}
              line={r ? r.line.text : e.where}
              {...(r?.line.warn ? { warn: true } : {})}
            />
          );
        })}
      </LinkList>
    </Section>
  );
}

// a screen outside Loja a search lands on wears its area's icon (Marketing's megaphone)
const iconOf = (to: string): Icon => {
  const area = areaOf(to);
  return NAV.find((n) => n.to === area)?.Icon ?? Compass;
};

/** The store as the customer meets it: logo, name and the address, a tap from opening it. */
function Identity({ s }: { s: StoreView }) {
  const url = s.url;
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-sunken">
        {s.profile.logoUrl ? (
          <img src={mediaUrl(s.profile.logoUrl)} alt="" className="size-full object-cover" />
        ) : (
          <span className="t-title-2" aria-hidden>
            {s.profile.name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="t-title-2 truncate">{s.profile.name}</p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="t-body inline-flex max-w-full items-center gap-1 text-muted underline underline-offset-2 hover:text-ink"
        >
          <span className="truncate">{hostOf(url)}</span>
          <ArrowSquareOut className="size-4 shrink-0" aria-hidden />
          <span className="sr-only">(abre em outra aba)</span>
        </a>
      </div>
      <Button
        size="sm"
        variant="secondary"
        icon={<Copy />}
        className="max-sm:w-full"
        onClick={() => void copyText(url).then((ok) => ok && toast('Link da loja copiado'))}
      >
        copiar link
      </Button>
    </Card>
  );
}
