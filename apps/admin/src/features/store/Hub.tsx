import {
  ArrowSquareOut,
  CalendarBlank,
  Clock,
  Copy,
  Globe,
  IdentificationBadge,
  Moped,
  PaintBrush,
  Timer,
  Wallet,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { todayHours } from '@vendua/kernel/rules';
import { api, type Payments, type StoreView } from '../../lib/api.ts';
import { hhmm, money, plural } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { copyText } from '../../ui/CopyValue.tsx';
import { ErrorState } from '../../ui/feedback.tsx';
import { LinkList, LinkRow } from '../../ui/LinkRow.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { METHOD_LABEL } from '../../ui/PaymentChip.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { BillingHoldNotice } from './BillingHold.tsx';
import { StatusPill, useStoreQuery } from './StatusPill.tsx';

// Loja is the store's setup at a glance: each part on its own screen, and each row saying what's
// set there now, so the merchant sees the whole store before opening any of it. A row that keeps
// the store from selling says why, in warning colour.

type Line = { text: string; warn?: boolean };

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

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
  if (o.minOrderCents) parts.push(`mínimo ${money(o.minOrderCents)}`);
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
  if (missing.length)
    return {
      text: `Falta ${missing.length > 1 ? `${missing.slice(0, -1).join(', ')} e ${missing.at(-1)}` : missing[0]}`,
      warn: true,
    };
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
  return {
    text: cap(
      names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : (names[0] ?? ''),
    ).replace(/\bpix\b/g, 'Pix'),
  };
}

export default function StoreHub() {
  const { data: s, error, refetch } = useStoreQuery();
  const pay = useQuery({ queryKey: qk.payments, queryFn: api.payments });
  return (
    <PageBody>
      <PageHeader
        title="Loja"
        subtitle="Como a loja funciona e como ela aparece para o cliente."
        actions={<StatusPill />}
      />
      {error && !s ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : !s ? (
        <RowsSkeleton rows={6} />
      ) : (
        <div className="space-y-8">
          {s.status.billingHold ? <BillingHoldNotice /> : null}
          <Identity s={s} />
          <Section title="Funcionamento" hint="Quando, como e em quanto tempo a loja atende.">
            <LinkList label="funcionamento">
              <Row to="/loja/horarios" Icon={Clock} title="Horários" line={hoursLine(s)} />
              <Row
                to="/loja/entrega"
                Icon={Moped}
                title="Entrega e retirada"
                line={deliveryLine(s)}
              />
              <Row to="/loja/preparo" Icon={Timer} title="Tempo de preparo" line={paceLine(s)} />
              <Row
                to="/loja/encomendas"
                Icon={CalendarBlank}
                title="Encomendas"
                line={encomendasLine(s)}
              />
            </LinkList>
          </Section>
          <Section title="Como a loja aparece" hint="O que o cliente vê ao abrir o link.">
            <LinkList label="como a loja aparece">
              <Row
                to="/loja/perfil"
                Icon={IdentificationBadge}
                title="Perfil da loja"
                line={profileLine(s)}
              />
              <Row
                to="/aparencia"
                Icon={PaintBrush}
                title="Aparência"
                line={{ text: 'A página, as cores e as fotos da loja' }}
              />
              <Row
                to="/loja/site"
                Icon={Globe}
                title="Site e endereço"
                line={{ text: hostOf(s.url) }}
              />
            </LinkList>
          </Section>
          <Section title="Recebimento">
            <LinkList label="recebimento">
              <Row
                to="/pagamentos/formas"
                Icon={Wallet}
                title="Formas de pagamento"
                line={paymentsLine(pay.data)}
              />
            </LinkList>
          </Section>
        </div>
      )}
    </PageBody>
  );
}

function Row(p: {
  to: string;
  Icon: Parameters<typeof LinkRow>[0]['Icon'];
  title: string;
  line: Line;
}) {
  return (
    <LinkRow
      to={p.to}
      Icon={p.Icon}
      title={p.title}
      line={p.line.text}
      {...(p.line.warn ? { warn: true } : {})}
    />
  );
}

/** The store as the customer meets it: logo, name and the address, a tap from opening it. */
function Identity({ s }: { s: StoreView }) {
  const url = s.url;
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-sunken">
        {s.profile.logoUrl ? (
          <img src={s.profile.logoUrl} alt="" className="size-full object-cover" />
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
