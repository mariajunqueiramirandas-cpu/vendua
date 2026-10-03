import { ArrowCounterClockwise, Gift, HandPalm, Lightning, type Icon } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  api,
  type ResultsPeriod,
  type VendedorResults,
  type VendedorSettings,
} from '../../lib/api.ts';
import { money, num, plural } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Chips } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { ReportsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { PersonaAvatar, reasonWord, SalesFunnel } from '../../ui/vendedor/index.ts';

const PERIODS: { value: ResultsPeriod; label: string }[] = [
  { value: 'today', label: 'hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
];

const seconds = (s: number) => (s < 1 ? 'menos de 1 s' : `${num(Math.round(s))} s`);
const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export default function Results() {
  // the route prefetches '7d', so the screen opens on it
  const [period, setPeriod] = useState<ResultsPeriod>('7d');
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: qk.vendedor.results(period),
    queryFn: () => api.vendedor.results(period),
    placeholderData: (p) => p,
  });
  return (
    <PageBody>
      <PageHeader
        title="Resultados"
        back="/vendedor"
        subtitle="O que o Duá vendeu e o que dá pra melhorar."
      />
      <Chips
        label="período"
        value={period}
        onChange={setPeriod}
        options={PERIODS}
        className="mb-6"
      />
      {error && !data ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : !data ? (
        <ReportsSkeleton chips={false} />
      ) : (
        <div
          aria-busy={isFetching || undefined}
          className={cn('space-y-6 transition-opacity', isFetching && 'opacity-70')}
        >
          <Body d={data} />
        </div>
      )}
    </PageBody>
  );
}

function Body({ d }: { d: VendedorResults }) {
  const empty = d.funnel.conversations === 0 && d.closed.orders === 0;
  if (empty)
    return (
      <Card className="flex flex-col items-center px-6 py-10 text-center">
        <PersonaAvatar size="lg" />
        <p className="t-title-2 mt-4 max-w-sm">Nenhuma conversa nesse período</p>
        <p className="t-body mt-2 max-w-sm text-muted">
          Os números aparecem quando o Duá começar a atender. Com uma semana de conversas eles ficam
          confiáveis.
        </p>
        <ButtonLink to="/vendedor/testar" variant="secondary" className="mt-5">
          testar como cliente
        </ButtonLink>
      </Card>
    );
  const f = d.funnel;
  // Core counts orders and conversations separately; a share above 100% would only confuse
  const closedShare =
    f.conversations > 0 && f.orders <= f.conversations
      ? Math.round((f.orders / f.conversations) * 100)
      : null;
  const handedOff = d.handoffs.reduce((n, h) => n + h.count, 0);
  return (
    <>
      {!d.enoughData ? (
        <Notice title="Ainda são poucas conversas">
          Com uma semana de conversas os números ficam confiáveis.
        </Notice>
      ) : null}

      <Card className="p-5">
        <p className="t-caption text-muted">Vendido pelo Duá</p>
        <p className="t-display tnum mt-1">{money(d.closed.cents)}</p>
        <p className="t-caption tnum text-muted">
          {plural(d.closed.orders, 'pedido fechado', 'pedidos fechados')} na conversa
        </p>
        {d.assisted.orders > 0 ? (
          <div className="mt-4 border-t border-line pt-3">
            <p className="t-label tnum">+ ajudou em {money(d.assisted.cents)}</p>
            <p className="t-caption text-muted">
              {plural(d.assisted.orders, 'pedido feito', 'pedidos feitos')} no site até{' '}
              {d.assisted.windowHours} h depois de ele mandar o link.
            </p>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="t-label">Da conversa ao pedido</h2>
            {closedShare !== null ? (
              <span className="t-caption tnum text-muted">{closedShare}% fecharam</span>
            ) : null}
          </div>
          <SalesFunnel
            steps={[
              { label: 'Conversas', value: f.conversations },
              { label: 'Montaram sacola', value: f.carts },
              { label: 'Viram o resumo', value: f.summaries },
              { label: 'Fecharam', value: f.orders },
            ]}
          />
        </Card>
        <Card className="p-5">
          <h2 className="t-label">Ticket médio</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Figure
              value={d.closed.averageCents === null ? '—' : money(d.closed.averageCents)}
              label="com o Duá"
            />
            <Figure
              value={d.siteAverageCents === null ? '—' : money(d.siteAverageCents)}
              label="no site"
            />
          </dl>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          <Line
            Icon={Gift}
            title="Sugestões"
            detail={`${plural(d.suggestions.offered, 'oferecida', 'oferecidas')}, ${plural(d.suggestions.taken, 'aceita', 'aceitas')}`}
            side={d.suggestions.revenueCents ? `+${money(d.suggestions.revenueCents)}` : null}
          />
          <Line
            Icon={ArrowCounterClockwise}
            title="Recuperados"
            detail={`${plural(d.recovered.orders, 'pedido', 'pedidos')} de sacolas paradas`}
            side={d.recovered.cents ? money(d.recovered.cents) : null}
          />
          <Line
            Icon={Lightning}
            title={
              d.replySec.p50 === null
                ? 'Tempo de resposta'
                : `Respondeu em ${seconds(d.replySec.p50)}`
            }
            detail={
              d.replySec.p50 === null
                ? 'Ainda sem respostas para medir'
                : d.replySec.p95 === null
                  ? 'na metade das vezes'
                  : seconds(d.replySec.p95) === seconds(d.replySec.p50)
                    ? 'quase sempre'
                    : `na metade das vezes · ${seconds(d.replySec.p95)} quase sempre`
            }
          />
          <Line
            Icon={HandPalm}
            title="Passou para você"
            detail={
              d.handoffs.length
                ? d.handoffs.map((h) => `${reasonWord(h.reason).word} (${num(h.count)})`).join(', ')
                : 'Nenhuma vez nesse período'
            }
            side={num(handedOff)}
          />
        </ul>
      </Card>

      {d.proposals.length ? <Proposals d={d} /> : null}
    </>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="t-caption text-muted">{label}</dt>
      <dd className="tnum font-display text-[1.5rem] font-semibold leading-8">{value}</dd>
    </div>
  );
}

function Line({
  Icon: I,
  title,
  detail,
  side,
}: {
  Icon: Icon;
  title: ReactNode;
  detail: ReactNode;
  side?: string | null | undefined;
}) {
  return (
    <li className="flex min-h-16 items-center gap-3 px-4 py-3">
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken text-muted"
      >
        <I weight="bold" className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="t-caption block text-muted">{detail}</span>
      </span>
      {side ? <span className="tnum shrink-0 font-semibold">{side}</span> : null}
    </li>
  );
}

function Proposals({ d }: { d: VendedorResults }) {
  const qc = useQueryClient();
  const wantsSettings = d.proposals.some((p) => p.kind === 'recovery_delay');
  const settings = useQuery({
    queryKey: qk.vendedor.settings,
    queryFn: api.vendedor.settings,
    enabled: wantsSettings,
  });
  const delay = settings.data?.settings.recovery.delayMin ?? null;
  // "mais cedo": a third sooner, never under Core's 5 min floor
  const sooner = delay === null ? null : Math.max(5, Math.round((delay * 2) / 3 / 5) * 5);
  const patch = useMutation({
    mutationFn: (delayMin: number) => api.vendedor.updateSettings({ recovery: { delayMin } }),
    onSuccess: (s: VendedorSettings) => {
      qc.setQueryData(qk.vendedor.settings, s);
      void qc.invalidateQueries({ queryKey: ['vendedor', 'results'] });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const remind = (from: number, to: number) =>
    patch.mutate(to, {
      onSuccess: () =>
        toast(`Lembrete da sacola parada: ${to} min`, { undo: () => patch.mutate(from) }),
    });
  return (
    <Section title="Para esta semana">
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {d.proposals.map((p) => {
            let action: ReactNode = null;
            let evidence = p.evidence;
            if (p.kind === 'answer')
              action = (
                <ButtonLink to="/vendedor/ensinar" variant="secondary" size="sm" className="h-12">
                  ensinar
                </ButtonLink>
              );
            else if (p.kind === 'retire_suggestion' && p.ref)
              action = (
                <ButtonLink
                  to={`/cardapio/produto/${p.ref}`}
                  variant="secondary"
                  size="sm"
                  className="h-12"
                >
                  ver produto
                </ButtonLink>
              );
            else if (p.kind === 'recovery_delay' && delay !== null && sooner !== null) {
              evidence = `${sentence(p.evidence)}. Hoje ele lembra depois de ${delay} min.`;
              if (sooner < delay)
                action = (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-12"
                    loading={patch.isPending}
                    onClick={() => remind(delay, sooner)}
                    aria-label={`lembrar depois de ${sooner} min`}
                  >
                    {sooner} min
                  </Button>
                );
            }
            return (
              <li
                key={`${p.kind}:${p.ref ?? ''}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-semibold">{sentence(p.text)}</p>
                  <p className="t-caption text-muted">{sentence(evidence)}</p>
                </div>
                {action ? <div className="shrink-0">{action}</div> : null}
              </li>
            );
          })}
        </ul>
      </Card>
    </Section>
  );
}
