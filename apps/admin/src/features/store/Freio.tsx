import { ArrowRight, CookingPot, Moped, Timer } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError, type Freio, type FreioLevel, type FreioMode } from '../../lib/api.ts';
import { clock, money, num } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { useCan } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { messageOf } from '../../ui/feedback.tsx';
import { Chips, Field, MoneyField, SavedStepper } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { toast } from '../../ui/Toast.tsx';

// Freio automático (0125, docs/features/freio-automatico.md). Core keeps the kitchen's queue and
// the brake; Início shows what needs a tap (a suggested pause, a pause to undo, an order about to
// be late) and Loja › Freio holds its settings.

const LEVEL: Record<FreioLevel, { label: string; tone: string }> = {
  normal: { label: 'tranquila', tone: 'bg-success-soft text-success' },
  busy: { label: 'movimentada', tone: 'bg-warning-soft text-warning' },
  full: { label: 'cheia', tone: 'bg-danger-soft text-danger' },
  pickup_only: { label: 'só retirada', tone: 'bg-danger-soft text-danger' },
};

export function useFreio(enabled = true) {
  return useQuery({ queryKey: qk.freio, queryFn: api.freio, enabled });
}

function useFreioAction<A>(fn: (a: A) => Promise<Freio>, done?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => {
      qc.setQueryData(qk.freio, d);
      void qc.invalidateQueries({ queryKey: qk.store });
      if (done) toast(done);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
}

/** Início › "Cozinha agora": shown while there's a queue or something to decide. */
export function FreioCard({ className = '' }: { className?: string }) {
  const manager = useCan('manager');
  const { data } = useFreio(manager);
  const apply = useFreioAction(
    () => api.freioApply(),
    'Entregas pausadas. A loja mostra só retirada.',
  );
  const dismiss = useFreioAction(() => api.freioDismiss());
  const release = useFreioAction(() => api.freioRelease(), 'Entregas de volta');
  const qc = useQueryClient();
  const late = useMutation({
    mutationFn: ({ id, send }: { id: string; send: boolean }) =>
      send
        ? api.freioLateSend(id).then((r) => {
            toast(
              r.notified
                ? r.coupon
                  ? `Cliente avisado, com o cupom ${r.coupon}`
                  : 'Cliente avisado'
                : 'Novo horário salvo. O cliente não tem WhatsApp para avisar.',
            );
            return r.freio;
          })
        : api.freioLateDismiss(id),
    onSuccess: (d) => {
      qc.setQueryData(qk.freio, d);
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  if (!manager || !data) return null;
  const { now } = data;
  const busy = now.queue > 0 || now.level !== 'normal';
  const decide = !!now.suggestion || !!now.deliveryPausedUntil || data.late.length > 0;
  if (data.settings.mode === 'off' && !data.late.length) return null;
  if (!busy && !decide) return null;
  const lv = LEVEL[now.level];
  return (
    <Section
      title="Cozinha agora"
      className={className}
      action={
        <Link
          to="/loja#freio"
          className="t-label inline-flex min-h-11 items-center gap-1 text-muted hover:text-ink"
        >
          ajustar <ArrowRight className="size-4" />
        </Link>
      }
    >
      <Card className="divide-y divide-line overflow-hidden">
        <div className="flex items-center gap-4 p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken">
            <CookingPot weight="bold" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {now.queue
                ? `${num(now.queue)} ${now.queue === 1 ? 'pedido' : 'pedidos'} na fila`
                : 'Fila vazia'}
            </p>
            <p className="t-caption text-muted">
              Retirada em ~{now.pickupMinutes} min
              {now.deliveryEnabled && !now.deliveryPausedUntil && now.backlogMinutes > 0
                ? ` · entrega +${now.backlogMinutes} min`
                : ''}
            </p>
          </div>
          <span
            className={cn('t-caption shrink-0 rounded-full px-2.5 py-1 font-semibold', lv.tone)}
          >
            {lv.label}
          </span>
        </div>
        {now.deliveryPausedUntil ? (
          <div className="space-y-3 p-4">
            <Notice
              tone="warning"
              title={`Entregas pausadas até ${clock(now.deliveryPausedUntil)}`}
            >
              A loja mostra só retirada até lá, com o tempo de verdade. Depois, as entregas voltam
              sozinhas.
            </Notice>
            <Button
              variant="secondary"
              size="sm"
              icon={<Moped />}
              loading={release.isPending}
              onClick={() => release.mutate(undefined)}
            >
              voltar a entregar agora
            </Button>
          </div>
        ) : now.suggestion ? (
          <div className="space-y-3 p-4">
            <Notice tone="danger" title="Cozinha cheia: pausar as entregas?">
              {now.suggestion.pausedUntil
                ? `Pedidos novos de entrega chegariam atrasados. Pausar até ${clock(now.suggestion.pausedUntil)} deixa só retirada, e as entregas voltam sozinhas.`
                : 'Pedidos novos de entrega chegariam atrasados. Pausar por um tempo deixa só retirada, e as entregas voltam sozinhas.'}
            </Notice>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={apply.isPending} onClick={() => apply.mutate(undefined)}>
                pausar entregas
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={dismiss.isPending}
                onClick={() => dismiss.mutate(undefined)}
              >
                agora não
              </Button>
            </div>
          </div>
        ) : null}
        {data.late.map((l) => (
          <div key={l.orderId} className="flex flex-wrap items-center gap-3 p-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-warning-soft text-warning">
              <Timer weight="bold" className="size-5" />
            </span>
            <div className="min-w-0 flex-1 basis-40">
              <Link to={`/pedidos/${l.orderId}`} className="block font-semibold hover:underline">
                #{l.number} vai atrasar ~{Math.max(5, Math.ceil(l.predictedMinutes / 5) * 5)} min
              </Link>
              <p className="t-caption text-muted">Avise antes que o cliente pergunte.</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={late.isPending && late.variables?.id === l.orderId && late.variables.send}
                onClick={() => late.mutate({ id: l.orderId, send: true })}
              >
                avisar o cliente
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={late.isPending && late.variables?.id === l.orderId && !late.variables.send}
                onClick={() => late.mutate({ id: l.orderId, send: false })}
              >
                não precisa
              </Button>
            </div>
          </div>
        ))}
      </Card>
    </Section>
  );
}

const MODES: { value: FreioMode; label: string }[] = [
  { value: 'off', label: 'Desligado' },
  { value: 'suggest', label: 'Sugerir' },
  { value: 'auto', label: 'Automático' },
];

const MODE_WORDS: Record<FreioMode, string> = {
  off: 'A loja promete os tempos de sempre e não pausa nada sozinha.',
  suggest:
    'A loja promete o tempo real da fila. Quando a cozinha enche, a gente pergunta se pode pausar as entregas.',
  auto: 'A loja promete o tempo real da fila e pausa as entregas sozinha quando a cozinha enche. Você recebe um aviso e pode desfazer.',
};

const LATE_WORDS: Record<FreioMode, string> = {
  off: 'Ninguém é avisado de atraso antes de perguntar.',
  suggest: 'Quando um pedido vai atrasar, a gente avisa você para mandar o novo horário.',
  auto: 'Quando um pedido vai atrasar, o cliente recebe o novo horário pelo WhatsApp da loja.',
};

/** Loja › Freio automático */
export function FreioSettings() {
  const manager = useCan('manager');
  const owner = useCan('owner');
  const qc = useQueryClient();
  const { data } = useFreio(manager);
  const save = (b: Parameters<typeof api.patchFreio>[0]) =>
    api.patchFreio(b).then(
      (d) => qc.setQueryData(qk.freio, d),
      (e) => {
        toast.error(
          e instanceof ApiError && e.code === 'FREIO_AUTO_LOCKED'
            ? 'O Automático libera quando a cozinha marca como pronto 8 de cada 10 pedidos da semana.'
            : messageOf(e),
        );
        throw e;
      },
    );
  const patch = useMutation({ mutationFn: save });
  if (!manager || !data) return null;
  const st = data.settings;
  const ready = Math.round(data.auto.readyRate * 100);
  return (
    <Section
      id="freio"
      title="Freio automático"
      hint="Quando a cozinha enche, a loja promete o tempo de verdade e, se precisar, segura as entregas por um tempo."
    >
      <Card className="space-y-5 p-5">
        <Field label="Modo">
          {owner ? (
            <Chips
              label="modo do freio"
              value={st.mode}
              options={MODES}
              onChange={(v) => patch.mutate({ mode: v })}
            />
          ) : (
            <p className="font-semibold">{MODES.find((m) => m.value === st.mode)?.label}</p>
          )}
        </Field>
        <p className="t-body -mt-2 text-muted">{MODE_WORDS[st.mode]}</p>
        {!data.auto.unlocked && st.mode !== 'auto' ? (
          <p className="t-caption -mt-2 text-muted">
            O Automático libera quando a cozinha marca como pronto 8 de cada 10 pedidos da semana
            {data.auto.orders ? ` (agora: ${ready}% de ${num(data.auto.orders)})` : ''}. Assim o
            freio sabe quanto a fila anda de verdade.
          </p>
        ) : null}
        {st.mode !== 'off' ? (
          <div className="grid gap-5 border-t border-line pt-4 sm:grid-cols-2">
            <Field
              label="Pedidos ao mesmo tempo"
              helper="Quantos pedidos a cozinha prepara de uma vez."
            >
              <SavedStepper
                label="pedidos ao mesmo tempo"
                value={st.capacity}
                min={1}
                max={20}
                onSave={(v) => save({ capacity: v }).catch(() => undefined)}
              />
            </Field>
            <Field label="Até o entregador sair" helper="Do pronto até a moto sair com o pedido.">
              <SavedStepper
                label="tempo até o entregador sair"
                value={st.bufferMinutes}
                min={0}
                max={60}
                step={5}
                suffix=" min"
                onSave={(v) => save({ bufferMinutes: v }).catch(() => undefined)}
              />
            </Field>
            <Field
              label="Maior espera aceitável"
              helper="Passou disso, o freio considera a cozinha cheia."
            >
              <SavedStepper
                label="maior espera aceitável"
                value={st.maxPromiseMinutes}
                min={30}
                max={240}
                step={10}
                suffix=" min"
                onSave={(v) => save({ maxPromiseMinutes: v }).catch(() => undefined)}
              />
            </Field>
          </div>
        ) : null}
        <div className="space-y-3 border-t border-line pt-4">
          <Field label="Pedido que vai atrasar">
            {owner ? (
              <Chips
                label="aviso de atraso"
                value={st.lateMode}
                options={MODES}
                onChange={(v) => patch.mutate({ lateMode: v })}
              />
            ) : (
              <p className="font-semibold">{MODES.find((m) => m.value === st.lateMode)?.label}</p>
            )}
          </Field>
          <p className="t-body text-muted">{LATE_WORDS[st.lateMode]}</p>
        </div>
        {st.lateMode !== 'off' && owner ? (
          <div className="space-y-4 rounded-md p-4 ring-1 ring-line">
            <div>
              <p className="font-semibold">Cupom de desculpas</p>
              <p className="t-caption text-muted">
                Vai junto com o aviso de atraso: uso único, só para aquele cliente, vale 30 dias. No
                máximo um a cada 14 dias por cliente.
              </p>
            </div>
            <Field label="O cupom dá">
              <Chips
                label="o que o cupom dá"
                value={st.apologyKind}
                options={[
                  { value: 'free_delivery', label: 'Entrega grátis' },
                  { value: 'fixed', label: 'Desconto em reais' },
                ]}
                onChange={(v) => patch.mutate({ apologyKind: v })}
              />
            </Field>
            {st.apologyKind === 'fixed' ? (
              <Field label="Valor do desconto" htmlFor="apology-value">
                <MoneyField
                  id="apology-value"
                  cents={st.apologyValueCents || null}
                  validate={(c) => (c > 10_000 ? `Até ${money(10_000)}.` : null)}
                  onCommit={(c) => patch.mutate({ apologyValueCents: c ?? 0 })}
                />
              </Field>
            ) : null}
            <Field
              label="Até quanto por mês"
              htmlFor="apology-budget"
              helper={
                st.apologyBudgetCents
                  ? `Neste mês: ${money(data.apology.spentCents)} usados, ${money(data.apology.leftCents)} sobrando.`
                  : 'Vazio = o aviso vai sem cupom.'
              }
            >
              <MoneyField
                id="apology-budget"
                allowEmpty
                cents={st.apologyBudgetCents || null}
                validate={(c) => (c > 1_000_000 ? `Até ${money(1_000_000)}.` : null)}
                onCommit={(c) => patch.mutate({ apologyBudgetCents: c ?? 0 })}
              />
            </Field>
          </div>
        ) : null}
      </Card>
    </Section>
  );
}
