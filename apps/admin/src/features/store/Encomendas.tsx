import {
  CalendarBlank,
  CalendarCheck,
  CalendarX,
  ChatCircleText,
  Clock,
  Confetti,
  HandCoins,
  X,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { PayMethod, StoreView } from '../../lib/api.ts';
import { dateShort, isoDate, money } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { can, useSession } from '../../lib/session.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import {
  Chips,
  Field,
  MoneyField,
  SavedStepper,
  TextArea,
  TextInput,
  Toggle,
} from '../../ui/fields.tsx';
import { LinkList, LinkRow } from '../../ui/LinkRow.tsx';
import { METHOD_LABEL } from '../../ui/PaymentChip.tsx';
import { toast } from '../../ui/Toast.tsx';

// Loja › Encomendas (Festa calculada F0, 0126): how far ahead, how they're paid, how many a day
// the kitchen takes, and the reminder the day before. Core enforces each one; this only sets them.

const WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
/** a ceiling the merchant turns on starts here */
const DEFAULT_CAP = 5;
const PRE_METHODS: PayMethod[] = ['pix', 'card_on_delivery', 'cash', 'meal_voucher'];
/** the share a sinal starts at when the owner turns it on */
const DEFAULT_SINAL_BPS = 5000;
const POLICY_MAX = 600;
/** Core keeps at most this many (preorder.ts BLOCKED_DATES_MAX) */
const BLOCKED_MAX = 120;
const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function Encomendas({
  s,
  run,
}: {
  s: StoreView;
  run: (b: Record<string, unknown>) => Promise<unknown>;
}) {
  const pre = s.preorder;
  const days = pre.capacity?.days ?? null;
  const capped = !!days && days.some((d) => d !== null);
  const save = (b: Record<string, unknown>) => run({ preorder: b }).catch(() => undefined);
  const setDay = (i: number, v: number | null) => {
    const next = Array.from({ length: 7 }, (_, k) => (k === i ? v : (days?.[k] ?? null)));
    return save({ capacity: { ...(pre.capacity ?? {}), days: next } });
  };
  return (
    <>
      <Section
        id="encomendas"
        title="Como a loja aceita encomendas"
        hint="A data é escolhida no fim do pedido. Um produto vira encomenda dentro dele, em Encomenda."
      >
        <Card className="space-y-5 p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Até quantos dias à frente"
              helper="A data mais distante que o cliente escolhe."
            >
              <SavedStepper
                label="dias à frente"
                value={pre.maxDays}
                min={1}
                max={120}
                suffix=" dias"
                onSave={(v) => save({ maxDays: v })}
              />
            </Field>
            <Field
              label="Pagamento das encomendas"
              helper="Só estas formas aparecem para encomendas."
            >
              <Chips
                multi
                label="formas de pagamento das encomendas"
                value={pre.paymentMethods}
                options={PRE_METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
                onChange={(m) => {
                  const has = pre.paymentMethods.includes(m);
                  if (has && pre.paymentMethods.length === 1) return;
                  void save({
                    paymentMethods: has
                      ? pre.paymentMethods.filter((x) => x !== m)
                      : [...pre.paymentMethods, m],
                  });
                }}
              />
            </Field>
          </div>
          <div className="border-t border-line pt-2">
            <Toggle
              checked={capped}
              onChange={(v) =>
                void save({
                  capacity: v
                    ? { ...(pre.capacity ?? {}), days: Array(7).fill(DEFAULT_CAP) }
                    : null,
                })
              }
              label={
                <span className="inline-flex items-center gap-2">
                  <CalendarCheck className="size-5 text-muted" /> Limite por dia
                </span>
              }
              description={
                capped
                  ? 'Num dia cheio, a data some do calendário do cliente.'
                  : 'Sem limite: qualquer dia aceita quantas encomendas vierem.'
              }
            />
            {capped ? (
              <ul className="mt-2 divide-y divide-line rounded-md ring-1 ring-line">
                {WEEK.map((name, i) => {
                  const v = days?.[i] ?? null;
                  return (
                    <li
                      key={name}
                      className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="font-semibold">{name}</span>
                      {v === null ? (
                        <span className="flex items-center gap-2">
                          <span className="t-caption text-muted">sem limite</span>
                          <button
                            type="button"
                            className="t-label min-h-11 rounded-full px-3 underline underline-offset-2"
                            onClick={() => void setDay(i, DEFAULT_CAP)}
                          >
                            limitar
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <SavedStepper
                            label={`encomendas na ${name.toLocaleLowerCase('pt-BR')}`}
                            value={v}
                            min={0}
                            max={500}
                            onSave={(n) => setDay(i, n)}
                          />
                          <button
                            type="button"
                            className="t-caption min-h-11 px-2 text-muted underline underline-offset-2"
                            onClick={() => void setDay(i, null)}
                          >
                            sem limite
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          <Sinal s={s} run={run} />
          <div className="border-t border-line pt-2">
            <Toggle
              checked={pre.reminder}
              onChange={(v) => void save({ reminder: v })}
              label={
                <span className="inline-flex items-center gap-2">
                  <ChatCircleText className="size-5 text-muted" /> Lembrete na véspera
                </span>
              }
              description="Às 9h do dia anterior, o cliente recebe um lembrete pelo WhatsApp da loja."
            />
          </div>
        </Card>
      </Section>
      <BlockedDates s={s} run={run} />
      <Section id="ver-tambem" title="Ver também">
        <LinkList label="ver também">
          <LinkRow
            to="/pedidos/agendados"
            Icon={CalendarBlank}
            title="Encomendas marcadas"
            line="O calendário com o que cada dia tem para entregar."
          />
          <LinkRow
            to="/cardapio/festa"
            Icon={Confetti}
            title="Calculadora de festa"
            line="O cliente diz quantas pessoas vêm e a loja calcula o resto."
          />
          <LinkRow
            to="/loja/horarios"
            Icon={Clock}
            title="Encomendas com a loja fechada"
            line={
              pre.whileClosed
                ? 'Ligado: fora do horário, entram pedidos só de encomendas.'
                : 'Desligado: fora do horário, nada entra.'
            }
          />
        </LinkList>
      </Section>
    </>
  );
}

/** Festa calculada F2 (0128): the sinal by Pix that locks a date. Money the shopper owes before
 *  the date: the owner's call. The policy is the store's own words, shown to the shopper. */
function Sinal({
  s,
  run,
}: {
  s: StoreView;
  run: (b: Record<string, unknown>) => Promise<unknown>;
}) {
  const owner = can(useSession().user.role, 'owner');
  const sinal = s.sinal;
  const on = sinal.bps > 0;
  const save = (b: Record<string, unknown>) => run({ sinal: b }).catch(() => undefined);
  const [policy, setPolicy] = useState(sinal.policy ?? '');
  useEffect(() => setPolicy(sinal.policy ?? ''), [sinal.policy]);
  const pct = sinal.bps / 100;
  return (
    <div className="border-t border-line pt-2">
      <Toggle
        checked={on}
        disabled={!owner}
        onChange={(v) => void save({ bps: v ? DEFAULT_SINAL_BPS : 0 })}
        label={
          <span className="inline-flex items-center gap-2">
            <HandCoins className="size-5 text-muted" /> Sinal para garantir a data
          </span>
        }
        description={
          on
            ? `Festas${sinal.minCents ? ` e encomendas a partir de ${money(sinal.minCents)}` : ''} pagam ${pct}% por Pix ao pedir. O restante vem por Pix antes do dia ou na retirada.`
            : 'Sem sinal: a encomenda é paga de uma vez.'
        }
      />
      {!owner ? (
        <p className="t-caption mt-1 text-muted">Só quem é dono da loja muda o sinal.</p>
      ) : null}
      {on && owner ? (
        <div className="mt-3 grid gap-5 sm:grid-cols-2">
          <Field label="Quanto do total" helper="Cobrado por Pix quando o cliente faz o pedido.">
            <SavedStepper
              label="porcentagem do sinal"
              value={pct}
              min={5}
              max={90}
              step={5}
              suffix="%"
              onSave={(v) => save({ bps: v * 100 })}
            />
          </Field>
          <Field
            label="Também para encomendas a partir de"
            helper="Vazio: só as festas pedem sinal."
          >
            <MoneyField
              cents={sinal.minCents}
              allowEmpty
              min={100}
              placeholder="só festas"
              onCommit={(v) => void save({ minCents: v })}
            />
          </Field>
          <Field
            label="Sua política de cancelamento"
            helper="O cliente lê antes de pagar, como texto da loja. Diga até quando o sinal volta."
            className="sm:col-span-2"
          >
            <TextArea
              value={policy}
              maxLength={POLICY_MAX}
              rows={3}
              placeholder="Ex.: cancelando até 7 dias antes, devolvemos o sinal."
              onChange={(e) => setPolicy(e.target.value)}
              onBlur={() => {
                const next = policy.trim();
                if (next !== (sinal.policy ?? '')) void save({ policy: next || null });
              }}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/** 0159: dates the calendar leaves out — the store stays open on them, it just takes no date. */
function BlockedDates({
  s,
  run,
}: {
  s: StoreView;
  run: (b: Record<string, unknown>) => Promise<unknown>;
}) {
  const qc = useQueryClient();
  const today = isoDate(new Date(), s.hours.timezone);
  const last = addDays(today, s.preorder.maxDays);
  const dates = s.preorder.blockedDates ?? [];
  const [date, setDate] = useState('');
  // every change goes from what Core holds now, so an undo never brings back a stale list
  const latest = () =>
    qc.getQueryData<StoreView>(qk.store)?.preorder.blockedDates ?? s.preorder.blockedDates ?? [];
  const save = (next: string[]) => run({ preorder: { blockedDates: next } });
  const taken = dates.includes(date);
  const problem = !date
    ? null
    : date < today
      ? 'Escolha hoje ou um dia depois.'
      : date > last
        ? `O calendário só vai até ${dateShort(last)} (Até quantos dias à frente).`
        : taken
          ? 'Essa data já está bloqueada.'
          : dates.length >= BLOCKED_MAX
            ? `Até ${BLOCKED_MAX} datas.`
            : null;
  const add = () => {
    if (!date || problem) return;
    const day = date;
    void save([...latest().filter((d) => d !== day), day]).then(
      () => {
        setDate('');
        toast(`${dateShort(day)}: bloqueado`, {
          undo: () => void save(latest().filter((d) => d !== day)).catch(() => undefined),
        });
      },
      () => undefined,
    );
  };
  const remove = (day: string) =>
    void save(latest().filter((d) => d !== day)).then(
      () =>
        toast(`${dateShort(day)}: liberado`, {
          undo: () => void save([...latest().filter((d) => d !== day), day]).catch(() => undefined),
        }),
      () => undefined,
    );
  return (
    <Section
      id="datas-bloqueadas"
      title="Datas bloqueadas"
      hint="Dias em que a loja não entrega nem separa encomenda. Eles somem do calendário do cliente."
    >
      <Card className="space-y-4 p-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Field label="Bloquear uma data" htmlFor="bd-date" className="min-w-0 flex-1 basis-52">
            <TextInput
              id="bd-date"
              type="date"
              min={today}
              max={last}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            icon={<CalendarX />}
            disabled={!date || !!problem}
          >
            bloquear
          </Button>
          {problem ? (
            <p className="t-caption basis-full text-danger" role="alert">
              {problem}
            </p>
          ) : null}
        </form>
        {dates.length ? (
          <ul className="flex flex-wrap gap-2" aria-label="datas bloqueadas">
            {dates.map((d) => (
              <li
                key={d}
                className="t-label inline-flex min-h-11 items-center gap-1 rounded-full bg-surface pl-4 pr-1 ring-1 ring-line-strong"
              >
                <span className="first-letter:uppercase">{dateShort(d)}</span>
                <IconButton label={`liberar ${dateShort(d)}`} size="sm" onClick={() => remove(d)}>
                  <X />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-caption text-muted">
            Nenhuma data bloqueada: o cliente escolhe qualquer dia em que a loja abre.
          </p>
        )}
        <p className="t-caption border-t border-line pt-3 text-muted">
          A loja continua aberta nesses dias para pedidos de agora. Para fechar o dia inteiro, use
          Feriados e dias especiais, em Horários.
        </p>
      </Card>
    </Section>
  );
}
