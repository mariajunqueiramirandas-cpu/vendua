import { CaretRight, WhatsappLogo } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type IncentiveReason,
  type StoreAgentSettings,
  type VendedorSettings,
} from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { ErrorState } from '../../ui/feedback.tsx';
import { Chips, Field, MoneyField, Segmented, Toggle } from '../../ui/fields.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
import { Bubble, PersonaAvatar } from '../../ui/vendedor/index.ts';
import {
  AnswerWhoField,
  CoverageField,
  greetingFor,
  Group,
  OwnerOnly,
  PhoneCommands,
  SaveStatus,
  ToneField,
  useSettingsPatch,
} from './Settings.parts.tsx';

export default function VendedorSettings() {
  const session = useSession();
  const { data, error, refetch } = useQuery({
    queryKey: qk.vendedor.settings,
    queryFn: api.vendedor.settings,
  });
  return (
    <PageBody>
      <PageHeader
        title="Configurar"
        back="/vendedor"
        subtitle="Como o Duá fala e o que ele pode fazer."
      />
      {data ? (
        <Editor v={data} owner={session.user.role === 'owner'} />
      ) : error ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : (
        <SectionsSkeleton />
      )}
    </PageBody>
  );
}

function Editor({ v, owner }: { v: VendedorSettings; owner: boolean }) {
  const s = v.settings;
  return (
    <div className="space-y-5">
      <Power v={v} owner={owner} />
      <Persona s={s} intro={v.intro} owner={owner} />
      <When s={s} />
      <Who s={s} />
      <Can v={v} owner={owner} />
      <Handoff s={s} />
    </div>
  );
}

function Power({ v, owner }: { v: VendedorSettings; owner: boolean }) {
  const { run, state, retry } = useSettingsPatch();
  const live = v.enabled && v.settings.coverage !== 'rehearsal';
  // he answers on the store's WhatsApp: switching on waits for it (Core: WHATSAPP_REQUIRED, on
  // the same `linked` as Início's). Unknown yet counts as linked, so the switch doesn't flash.
  const home = useQuery({ queryKey: qk.vendedor.home, queryFn: api.vendedor.home });
  const linked = home.data?.whatsapp.linked ?? true;
  const blocked = !v.enabled && !linked;
  return (
    <Group
      title={
        <span className="flex items-center gap-2.5">
          <PersonaAvatar size="sm" answering={live} />
          Ligar o Duá
        </span>
      }
      status={<SaveStatus state={state} retry={retry} />}
    >
      <Toggle
        checked={v.enabled}
        disabled={!owner || blocked}
        onChange={(enabled) => void run({ enabled })}
        label={v.enabled ? 'Ligado' : 'Desligado'}
        description={
          <>
            {!v.enabled
              ? 'As conversas ficam com você até você ligar.'
              : linked
                ? v.settings.coverage === 'rehearsal'
                  ? 'Em ensaio no WhatsApp da loja: escreve, mas não manda. Desligue e as conversas ficam com você.'
                  : 'Atendendo no WhatsApp da loja. Desligue e as conversas ficam com você.'
                : 'O WhatsApp da loja está sem conexão: ele volta a atender quando conectar. Desligue e as conversas ficam com você.'}
            {owner ? null : (
              <>
                {' '}
                <OwnerOnly />
              </>
            )}
          </>
        }
      />
      {blocked ? (
        <Link
          to={owner ? '/vendedor/comecar?passo=whatsapp' : '/whatsapp'}
          className="t-label -mx-4 -mb-3 flex min-h-13 items-center gap-3 rounded-b-lg border-t border-line px-4 hover:bg-hover"
        >
          <WhatsappLogo weight="fill" className="size-5 shrink-0 text-whatsapp" aria-hidden />
          <span className="min-w-0 flex-1">Conecte o WhatsApp da loja primeiro</span>
          <CaretRight weight="bold" className="size-4 shrink-0 text-muted" aria-hidden />
        </Link>
      ) : null}
    </Group>
  );
}

function Persona({ s, intro, owner }: { s: StoreAgentSettings; intro: string; owner: boolean }) {
  const { run, state, retry } = useSettingsPatch();
  return (
    <Group title="Como ele se apresenta" status={<SaveStatus state={state} retry={retry} />}>
      <Toggle
        checked={s.disclose}
        disabled={!owner}
        onChange={(disclose) => void run({ disclose })}
        label="Dizer que é assistente virtual"
        description={
          <>
            {s.disclose
              ? 'Ele se apresenta como assistente virtual da loja.'
              : 'Ele se apresenta só como o Duá da loja, nunca diz que é uma pessoa e conta a verdade se perguntarem.'}
            {owner ? null : (
              <>
                {' '}
                <OwnerOnly />
              </>
            )}
          </>
        }
      />
      <ToneField value={s.tone} onChange={(tone) => void run({ tone })} />
      <div aria-live="polite" className="mt-2 flex flex-col rounded-md bg-sunken p-3">
        <span className="t-caption mb-1 text-muted">prévia</span>
        <Bubble voice="seller" align="start">
          {greetingFor(s.tone, intro)}
        </Bubble>
      </div>
    </Group>
  );
}

function When({ s }: { s: StoreAgentSettings }) {
  const { run, state, retry } = useSettingsPatch();
  return (
    <Group title="Quando o Duá atende" status={<SaveStatus state={state} retry={retry} />}>
      <CoverageField
        value={s.coverage}
        slowAfterMin={s.slowAfterMin}
        onChange={(coverage) => void run({ coverage })}
        onWait={(slowAfterMin) => void run({ slowAfterMin })}
      />
    </Group>
  );
}

function Who({ s }: { s: StoreAgentSettings }) {
  const { run, state, retry } = useSettingsPatch();
  return (
    <Group title="Quem o Duá atende" status={<SaveStatus state={state} retry={retry} />}>
      <AnswerWhoField value={s.answerWho} onChange={(answerWho) => void run({ answerWho })} />
      <PhoneCommands />
    </Group>
  );
}

const REMIND = [10, 15, 30, 60];

function Can({ v, owner }: { v: VendedorSettings; owner: boolean }) {
  const { run, state, retry } = useSettingsPatch();
  const s = v.settings;
  const c = s.capabilities;
  const remind = REMIND.includes(s.recovery.delayMin)
    ? REMIND
    : [...REMIND, s.recovery.delayMin].sort((a, b) => a - b);
  return (
    <Group title="O que o Duá pode fazer" status={<SaveStatus state={state} retry={retry} />}>
      <div className="divide-y divide-line">
        <Toggle
          checked={c.closeOrder}
          onChange={(closeOrder) => void run({ capabilities: { closeOrder } })}
          label="Fechar o pedido"
          description="Desligado, ele manda o link com a sacola pronta."
        />
        <Toggle
          checked={c.sendPix}
          onChange={(sendPix) => void run({ capabilities: { sendPix } })}
          label="Mandar o Pix"
          description="O código vai sozinho, fácil de copiar."
        />
        <Toggle
          checked={c.suggest}
          onChange={(suggest) => void run({ capabilities: { suggest } })}
          label="Sugerir adicionais"
          description="No máximo uma sugestão por pedido."
        />
        <div>
          <Toggle
            checked={s.recovery.enabled}
            onChange={(enabled) => void run({ recovery: { enabled } })}
            label="Lembrar sacola parada"
            description={
              s.recovery.enabled
                ? `Escreve para quem montou a sacola e sumiu, depois de ${s.recovery.delayMin} min.`
                : 'Ele não escreve para quem montou a sacola e sumiu.'
            }
          />
          {s.recovery.enabled ? (
            <Segmented
              label="lembrar depois de"
              value={String(s.recovery.delayMin)}
              onChange={(m) => void run({ recovery: { delayMin: Number(m) } })}
              options={remind.map((m) => ({ value: String(m), label: `${m} min` }))}
              className="mb-3"
            />
          ) : null}
        </div>
        <div>
          <Toggle
            checked={c.coupons}
            disabled={!owner}
            onChange={(coupons) => void run({ capabilities: { coupons } })}
            label="Oferecer cupons"
            description={
              owner ? (
                'Só os que você escolher, até o limite do mês que você definir.'
              ) : (
                <>
                  Só os cupons que o dono escolher. <OwnerOnly />
                </>
              )
            }
          />
          {c.coupons ? <Incentives v={v} owner={owner} run={run} /> : null}
        </div>
      </div>
    </Group>
  );
}

const REASONS: { value: IncentiveReason; label: string }[] = [
  { value: 'recovery', label: 'sacola parada' },
  { value: 'first_order', label: 'primeiro pedido' },
  { value: 'hesitation', label: 'cliente em dúvida' },
];

/** Which coupons, when, and the month's limit (owner: it's the store's money). */
function Incentives({
  v,
  owner,
  run,
}: {
  v: VendedorSettings;
  owner: boolean;
  run: ReturnType<typeof useSettingsPatch>['run'];
}) {
  const inc = v.settings.incentives;
  const [couponIds, setCoupons] = useState<string[]>(inc?.couponIds ?? []);
  const [reasons, setReasons] = useState<IncentiveReason[]>(inc?.reasons ?? []);
  const [budget, setBudget] = useState<number | null>(inc?.monthlyBudgetCents ?? null);
  // a refetch (another card saved) must not wipe a pick that isn't complete enough to save yet
  const saved = JSON.stringify(inc);
  useEffect(() => {
    setCoupons(inc?.couponIds ?? []);
    setReasons(inc?.reasons ?? []);
    setBudget(inc?.monthlyBudgetCents ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);
  const save = (next: {
    couponIds: string[];
    reasons: IncentiveReason[];
    budget: number | null;
  }) => {
    if (!next.couponIds.length || !next.reasons.length || !next.budget) return;
    void run({
      incentives: {
        couponIds: next.couponIds,
        reasons: next.reasons,
        monthlyBudgetCents: next.budget,
        minOrderCents: inc?.minOrderCents ?? 0,
        perCustomerDays: inc?.perCustomerDays ?? 30,
      },
    });
  };
  const toggle = <T,>(list: T[], x: T) =>
    list.includes(x) ? list.filter((y) => y !== x) : [...list, x];

  if (!owner)
    return (
      <p className="t-caption pb-3 text-muted">
        {inc
          ? `${inc.couponIds.length === 1 ? '1 cupom' : `${inc.couponIds.length} cupons`}, até ${money(inc.monthlyBudgetCents)} por mês.`
          : 'O dono ainda não escolheu os cupons.'}
      </p>
    );
  if (!v.coupons.length)
    return (
      <p className="t-body pb-3 text-muted">
        A loja ainda não tem cupons.{' '}
        <Link to="/marketing" className="font-semibold text-ink underline underline-offset-2">
          criar um cupom
        </Link>
      </p>
    );
  const ready = couponIds.length > 0 && reasons.length > 0 && !!budget;
  return (
    <div className="space-y-4 pb-4">
      <div className="space-y-2">
        <p className="t-label">Quais cupons</p>
        <Chips
          multi
          label="Quais cupons"
          value={couponIds}
          onChange={(id) => {
            const next = toggle(couponIds, id);
            setCoupons(next);
            save({ couponIds: next, reasons, budget });
          }}
          options={v.coupons.map((c) => ({ value: c.id, label: c.label ?? c.code }))}
        />
      </div>
      <div className="space-y-2">
        <p className="t-label">Quando oferecer</p>
        <Chips
          multi
          label="Quando oferecer"
          value={reasons}
          onChange={(r) => {
            const next = toggle(reasons, r);
            setReasons(next);
            save({ couponIds, reasons: next, budget });
          }}
          options={REASONS}
        />
      </div>
      <Field
        label="Limite por mês"
        htmlFor="v-budget"
        helper={`Este mês ele já deu ${money(v.incentivesUsedCents)} em descontos.`}
      >
        <MoneyField
          id="v-budget"
          cents={budget}
          min={100}
          allowEmpty
          onCommit={(c) => {
            setBudget(c);
            save({ couponIds, reasons, budget: c });
          }}
        />
      </Field>
      {!ready ? (
        <p className="t-caption text-muted">
          Escolha ao menos um cupom, quando oferecer e o limite do mês para ele começar.
        </p>
      ) : null}
    </div>
  );
}

const SILENCE = [15, 30, 60, 120];

function Handoff({ s }: { s: StoreAgentSettings }) {
  const { run, state, retry } = useSettingsPatch();
  const [silence, setSilence] = useState(false);
  const h = s.handoff;
  const above = h.aboveCents !== null;
  const silences = SILENCE.includes(s.humanSilenceMin)
    ? SILENCE
    : [...SILENCE, s.humanSilenceMin].sort((a, b) => a - b);
  return (
    <Group title="Passe para mim quando" status={<SaveStatus state={state} retry={retry} />}>
      <div className="divide-y divide-line">
        <Toggle
          checked={h.complaint}
          onChange={(complaint) => void run({ handoff: { complaint } })}
          label="Reclamação ou atraso"
          description="Ele pede desculpa, diz o que sabe do pedido e chama você."
        />
        <Toggle
          checked={h.allergy}
          onChange={(allergy) => void run({ handoff: { allergy } })}
          label="Alergia ou restrição"
          description="Ele não arrisca: chama você antes de responder."
        />
        <div>
          <Toggle
            checked={above}
            onChange={(on) => void run({ handoff: { aboveCents: on ? 30_000 : null } })}
            label={above ? `Pedido acima de ${money(h.aboveCents ?? 0)}` : 'Pedido grande'}
            description="Para você conferir antes de ele fechar."
          />
          {above ? (
            <div className="pb-3">
              <Field label="A partir de" htmlFor="v-above">
                <MoneyField
                  id="v-above"
                  cents={h.aboveCents}
                  min={100}
                  onCommit={(c) => c !== null && void run({ handoff: { aboveCents: c } })}
                />
              </Field>
            </div>
          ) : null}
        </div>
        <Toggle
          checked={h.newCashCustomer}
          onChange={(newCashCustomer) => void run({ handoff: { newCashCustomer } })}
          label="Cliente novo pagando em dinheiro"
          description="Para você confirmar o troco e o endereço."
        />
        <div className="py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <p className="t-body min-w-0 flex-1 basis-52 text-muted">
              O Duá volta sozinho depois de {s.humanSilenceMin} min sem resposta sua.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-12"
              aria-expanded={silence}
              onClick={() => setSilence((x) => !x)}
            >
              {silence ? 'pronto' : 'trocar'}
            </Button>
          </div>
          {silence ? (
            <Segmented
              label="o Duá volta depois de"
              value={String(s.humanSilenceMin)}
              onChange={(m) => void run({ humanSilenceMin: Number(m) })}
              options={silences.map((m) => ({
                value: String(m),
                label: m >= 60 ? `${m / 60} h` : `${m} min`,
              }))}
              className="mt-1"
            />
          ) : null}
        </div>
      </div>
    </Group>
  );
}
