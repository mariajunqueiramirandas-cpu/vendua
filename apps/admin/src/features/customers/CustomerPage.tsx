import { DownloadSimple, Gift, ShieldCheck, WhatsappLogo } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { dateShort, money, phone, plural, whatsappLink } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { useCan, useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Field, TextInput } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { DetailSkeleton } from '../../ui/skeletons.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';
import { OrderRowView } from '../orders/OrderRowView.tsx';

export default function CustomerPage() {
  const { phone: ph = '' } = useParams();
  const s = useSession();
  const owner = useCan('owner');
  const { data, error, refetch } = useQuery({
    queryKey: qk.customer(ph),
    queryFn: () => api.customer(ph),
  });
  const [forget, setForget] = useState(false);
  if (error && !data)
    return (
      <PageBody>
        <PageHeader title="Cliente" back="/clientes" />
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  if (!data)
    return (
      <PageBody>
        <PageHeader title="Cliente" back="/clientes" />
        <DetailSkeleton />
      </PageBody>
    );
  const c = data.customer;
  const l = data.loyalty;
  const exportJson = async () => {
    try {
      const body = await api.exportCustomer(ph);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `cliente-${ph}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(messageOf(e));
    }
  };
  return (
    <PageBody>
      <PageHeader title={c.name} subtitle={phone(c.phone)} back="/clientes" />
      <div className="mb-5 flex flex-wrap gap-2">
        <a
          href={whatsappLink(c.phone, `Oi, ${c.name.split(' ')[0]}! Aqui é da ${s.store.name}.`)}
          target="_blank"
          rel="noreferrer"
          className="t-label inline-flex min-h-12 items-center gap-2 rounded-md bg-[#1f7a4d] px-4 text-white"
        >
          <WhatsappLogo weight="fill" className="size-5" /> conversar no WhatsApp
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['pedidos', String(c.orders)],
          ['gastou no total', money(c.spentCents)],
          ['ticket médio', c.orders ? money(Math.round(c.spentCents / c.orders)) : '—'],
          ['cliente desde', dateShort(c.firstAt)],
        ].map(([k, v]) => (
          <Card key={k} className="p-4">
            <p className="tnum font-display text-xl font-semibold">{v}</p>
            <p className="t-caption text-muted">{k}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="space-y-8">
          {l.enabled ? (
            <Section title="Cartão fidelidade">
              <Card className="p-5">
                <div
                  className="flex flex-wrap gap-2"
                  role="img"
                  aria-label={`${l.stamps} de ${l.stampsRequired} selos`}
                >
                  {Array.from({ length: l.stampsRequired }, (_, i) => (
                    <span
                      key={i}
                      className={cn(
                        'grid size-10 place-items-center rounded-full ring-2',
                        i < l.stamps
                          ? 'bg-spark text-on-spark ring-spark'
                          : 'ring-line-strong text-faint',
                      )}
                    >
                      {i < l.stamps ? '★' : i + 1}
                    </span>
                  ))}
                </div>
                <p className="t-body mt-3 text-muted">
                  Faltam {Math.max(0, l.stampsRequired - l.stamps)} para ganhar {l.rewardLabel}.
                </p>
                {l.rewards.length ? (
                  <ul className="mt-3 space-y-1">
                    {l.rewards.map((r) => (
                      <li key={r.code} className="t-body flex items-center gap-2">
                        <Gift className="size-5 text-success" /> <strong>{r.code}</strong> ·{' '}
                        {r.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            </Section>
          ) : null}
          {data.favorites.length ? (
            <Section title="O que mais pede">
              <Card className="divide-y divide-line">
                {data.favorites.map((f) => (
                  <div key={f.name} className="flex min-h-14 items-center justify-between px-4">
                    <span>{f.name}</span>
                    <span className="tnum font-semibold">{f.qty}×</span>
                  </div>
                ))}
              </Card>
            </Section>
          ) : null}
          {data.lastAddress ? (
            <Section title="Último endereço">
              <Card className="p-4">
                <p>
                  {[data.lastAddress.address, data.lastAddress.neighborhood]
                    .filter(Boolean)
                    .join(' — ')}
                </p>
              </Card>
            </Section>
          ) : null}
          {owner ? (
            <Section
              title="Dados pessoais (LGPD)"
              hint="Quando o cliente pedir uma cópia dos dados ou para apagar."
            >
              <Card className="flex flex-wrap gap-2 p-4">
                <Button
                  variant="secondary"
                  icon={<DownloadSimple />}
                  onClick={() => void exportJson()}
                >
                  baixar dados
                </Button>
                <Button
                  variant="ghost"
                  className="text-danger"
                  icon={<ShieldCheck />}
                  onClick={() => setForget(true)}
                >
                  apagar dados do cliente
                </Button>
              </Card>
            </Section>
          ) : null}
        </div>
        <Section title="Pedidos">
          <Card className="overflow-hidden">
            <ul>
              {data.orders.map((o) => (
                <OrderRowView key={o.id} o={o} />
              ))}
            </ul>
          </Card>
        </Section>
      </div>
      <ForgetSheet open={forget} onOpenChange={setForget} phone={c.phone} name={c.name} />
    </PageBody>
  );
}

function ForgetSheet({
  open,
  onOpenChange,
  phone: ph,
  name,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  phone: string;
  name: string;
}) {
  const [confirm, setConfirm] = useState('');
  const qc = useQueryClient();
  const nav = useNavigate();
  const run = useMutation({
    mutationFn: () => api.forgetCustomer(ph, confirm),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      toast(
        `Dados apagados. ${plural(r.anonymized, 'pedido ficou', 'pedidos ficaram')} sem nome e telefone.`,
      );
      nav('/clientes');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const ok = confirm === ph.slice(-4);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Apagar os dados de ${name}?`}
      description="Os pedidos continuam nos seus relatórios, mas sem nome, telefone e endereço. Não dá para desfazer."
      footer={
        <HoldButton disabled={!ok || run.isPending} onConfirm={() => run.mutate()}>
          {run.isPending ? 'apagando…' : 'segure para apagar'}
        </HoldButton>
      }
    >
      <Field
        label="Para confirmar, digite os 4 últimos números do telefone"
        htmlFor="forget-confirm"
        className="pt-2"
      >
        <TextInput
          id="forget-confirm"
          inputMode="numeric"
          maxLength={4}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
          className="tnum w-32 text-center"
        />
      </Field>
    </Sheet>
  );
}
