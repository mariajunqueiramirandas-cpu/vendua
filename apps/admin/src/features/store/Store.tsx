import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  CalendarPlus,
  Clock,
  Crosshair,
  Fire,
  MagnifyingGlass,
  MapPin,
  Moped,
  PencilSimple,
  Plus,
  Polygon,
  Storefront,
  Trash,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { instagramHandle, whatsappDigits } from '@vendua/kernel/rules';
import { api, ApiError, type SpecialDay, type StoreView, type Zone } from '../../lib/api.ts';
import { useAutosave } from '../../lib/autosave.ts';
import { dateShort, hhmm, isoDate, money, phone } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, messageOf, DuaNote } from '../../ui/feedback.tsx';
import {
  Chips,
  CommitInput,
  Field,
  MoneyField,
  SaveMark,
  SavedStepper,
  Stepper,
  TextArea,
  TextInput,
  TimeInput,
  Toggle,
  useSaveState,
} from '../../ui/fields.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
import { PhotoField } from '../../ui/PhotoField.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { fromWeek, TimeRangeField, toWeek, type WeekModel } from '../../ui/TimeRangeField.tsx';
import { toast } from '../../ui/Toast.tsx';
import { useHeld } from '../menu/held.ts';
import { BillingHoldNotice } from './BillingHold.tsx';
import { holidaysAhead, type Holiday } from './holidays.ts';
import { StatusPill, useStoreQuery } from './StatusPill.tsx';
import { Notice } from '../../ui/Notice.tsx';

const ZoneMap = lazy(() => import('../../ui/ZoneMap.tsx').then((m) => ({ default: m.ZoneMap })));

export default function Store() {
  const { data, error, refetch } = useStoreQuery();
  if (error && !data)
    return (
      <PageBody>
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  if (!data)
    return (
      <PageBody>
        <PageHeader title="Loja" />
        <SectionsSkeleton columns={2} />
      </PageBody>
    );
  return <StoreEditor s={data} />;
}

// every section saves on its own: only the newest reply may paint, an older one asks for the truth
let storeSeq = 0;

function useStorePatch() {
  const qc = useQueryClient();
  const save = useSaveState();
  const run = (body: Record<string, unknown>) => {
    const mine = ++storeSeq;
    return save
      .track(api.updateStore(body))
      .then((s) => {
        if (mine === storeSeq) qc.setQueryData(qk.store, s);
        else void qc.invalidateQueries({ queryKey: qk.store });
        void qc.invalidateQueries({ queryKey: qk.home });
        void qc.invalidateQueries({ queryKey: qk.session });
        return s;
      })
      .catch((e) => {
        toast.error(messageOf(e));
        throw e;
      });
  };
  return { run, state: save.state };
}

function StoreEditor({ s }: { s: StoreView }) {
  const { run, state } = useStorePatch();
  useEffect(() => {
    // deep links from elsewhere (Relatórios → /loja#entrega) land on their section
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);
  const patch = (b: Record<string, unknown>) => void run(b).catch(() => undefined);
  return (
    <PageBody wide>
      <PageHeader
        title="Loja"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {s.url.replace('https://', '')}
            </a>
            <SaveMark state={state} />
          </span>
        }
        actions={<StatusPill />}
      />
      {s.status.billingHold ? <BillingHoldNotice className="mb-6" /> : null}
      <nav aria-label="seções" className="scroll-row -mx-4 mb-6 px-4 md:-mx-8 md:px-8">
        <ul className="flex w-max gap-2">
          {[
            ['horarios', 'Horários'],
            ['entrega', 'Entrega e retirada'],
            ['perfil', 'Perfil'],
            ['mensagens', 'Mensagens'],
          ].map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="t-label inline-flex min-h-11 items-center rounded-full bg-surface px-4 ring-1 ring-line-strong hover:bg-hover"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-8">
          <Hours s={s} patch={patch} />
          <SpecialDays s={s} run={run} />
          <Section
            id="mensagens"
            title="Mensagens"
            hint="O que a loja diz quando não está aceitando pedidos."
          >
            <Card className="space-y-5 p-5">
              <Field label="Quando pausada" htmlFor="m-pause" optional>
                <CommitInput
                  id="m-pause"
                  multiline
                  maxLength={200}
                  value={s.status.pauseMessage ?? ''}
                  placeholder="Ex.: Voltamos às 18h com fornada nova!"
                  onCommit={(v) => patch({ messages: { pause: v || null } })}
                />
              </Field>
              <Field
                label="Quando fechada"
                htmlFor="m-closed"
                optional
                helper="Sem recado, a loja mostra quando abre de novo."
              >
                <CommitInput
                  id="m-closed"
                  multiline
                  maxLength={200}
                  value={s.status.closedMessage ?? ''}
                  placeholder="Ex.: Abrimos amanhã às 9h. Já dá para encomendar!"
                  onCommit={(v) => patch({ messages: { closed: v || null } })}
                />
              </Field>
              <Toggle
                checked={s.operations.demand === 'high'}
                onChange={(v) => patch({ operations: { demand: v ? 'high' : 'normal' } })}
                label={
                  <span className="inline-flex items-center gap-2">
                    <Fire className="size-5 text-warning" /> Muitos pedidos agora
                  </span>
                }
                description={`Avisa na loja que o preparo está levando mais que os ~${s.operations.prepTimeMinutes} min de sempre.`}
              />
            </Card>
          </Section>
        </div>
        <div className="space-y-8">
          <Delivery s={s} patch={patch} run={run} />
          <Profile s={s} patch={patch} run={run} />
        </div>
      </div>
    </PageBody>
  );
}

function Hours({ s, patch }: { s: StoreView; patch: (b: Record<string, unknown>) => void }) {
  const qc = useQueryClient();
  const { draft, setDraft, state } = useAutosave<WeekModel>(toWeek(s.hours.windows), async (w) => {
    const next = await api.updateStore({ hours: fromWeek(w) });
    qc.setQueryData(qk.store, next);
    void qc.invalidateQueries({ queryKey: qk.home });
    return toWeek(next.hours.windows);
  });
  return (
    <Section
      id="horarios"
      title="Horários"
      hint="Quando a loja aceita pedidos para agora."
      action={<SaveMark state={state} />}
    >
      <Card className="px-4 py-1">
        <TimeRangeField value={draft} onChange={setDraft} />
      </Card>
      <Card className="mt-3 px-4 py-1">
        <Toggle
          checked={s.preorder.whileClosed}
          onChange={(v) => patch({ preorder: { whileClosed: v } })}
          label="Encomendas com a loja fechada"
          description={
            s.preorder.whileClosed
              ? 'Fora do horário, só entram pedidos feitos apenas de encomendas.'
              : 'Fora do horário, a loja não recebe pedidos, nem de encomenda.'
          }
        />
      </Card>
    </Section>
  );
}

/** Core's cap on a range (modules/store.ts SPECIAL_RANGE_MAX_DAYS) */
const RANGE_MAX_DAYS = 62;
const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
/** one entry per (date, until, yearly) in Core's list */
const dayKey = (d: SpecialDay) => `${d.date}|${d.until ?? ''}|${d.yearly ? 'y' : ''}`;
/** "25 dez", no weekday: a yearly day falls on a different one each year */
const dayMonth = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${iso}T12:00:00Z`))
    .replace(/\./g, '')
    .replace(/ de /g, ' ');
/** the next time a yearly day comes round, from `today` */
const nextTurn = (d: SpecialDay, today: string) => {
  const y = Number(today.slice(0, 4));
  for (const year of [y - 1, y, y + 1]) {
    const shift = year - Number(d.date.slice(0, 4));
    const from = `${year}${d.date.slice(4)}`;
    const to = d.until ? `${Number(d.until.slice(0, 4)) + shift}${d.until.slice(4)}` : from;
    if (to >= today && from >= d.date) return { from, to };
  }
  return { from: d.date, to: d.until ?? d.date };
};
const whenText = (d: SpecialDay, today: string) => {
  if (d.yearly) {
    const t = nextTurn(d, today);
    return d.until ? `${dayMonth(t.from)} a ${dayMonth(t.to)}` : dayMonth(t.from);
  }
  return d.until ? `${dateShort(d.date)} a ${dateShort(d.until)}` : dateShort(d.date);
};

function SpecialDays({
  s,
  run,
}: {
  s: StoreView;
  run: (b: Record<string, unknown>) => Promise<StoreView>;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SpecialDay | 'new' | null>(null);
  const today = isoDate(new Date(), s.hours.timezone);
  // every change goes from what Core holds now, so an undo never brings back a stale list
  const latest = () => qc.getQueryData<StoreView>(qk.store)?.specialDays ?? s.specialDays;
  const save = (days: SpecialDay[]) => run({ specialDays: days });
  const upcoming = s.specialDays
    .filter((d) => d.yearly || (d.until ?? d.date) >= today)
    .map((d) => ({ d, at: d.yearly ? nextTurn(d, today).from : d.date }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((x) => x.d);
  // the national holidays still free, the nearest first
  const taken = new Set((s.specialDaysAhead ?? []).map((d) => d.date));
  const holidays = holidaysAhead(today)
    .filter((h) => !taken.has(h.date))
    .slice(0, 6);
  const remove = (d: SpecialDay) =>
    void save(latest().filter((x) => dayKey(x) !== dayKey(d))).then(
      () =>
        toast(`${d.label ?? whenText(d, today)}: tirado`, {
          undo: () =>
            void save([...latest().filter((x) => dayKey(x) !== dayKey(d)), d]).catch(
              () => undefined,
            ),
        }),
      () => undefined,
    );
  const addHoliday = (h: Holiday) => {
    const day: SpecialDay = {
      date: h.date,
      closed: true,
      label: h.label,
      ...(h.until ? { until: h.until } : {}),
      ...(h.yearly ? { yearly: true } : {}),
    };
    void save([...latest().filter((x) => dayKey(x) !== dayKey(day)), day]).then(
      () =>
        toast(`${h.label}: fechado${h.yearly ? ', todo ano' : ''}`, {
          undo: () =>
            void save(latest().filter((x) => dayKey(x) !== dayKey(day))).catch(() => undefined),
        }),
      () => undefined,
    );
  };
  return (
    <Section
      id="dias-especiais"
      title="Feriados e dias especiais"
      hint="Dias fechados ou com horário diferente, sem mexer na semana."
      action={
        <Button
          variant="secondary"
          size="sm"
          icon={<CalendarPlus />}
          aria-label="adicionar dia"
          onClick={() => setEditing('new')}
        >
          adicionar
        </Button>
      }
    >
      {upcoming.length ? (
        <Card className="divide-y divide-line overflow-hidden">
          {upcoming.map((d) => (
            <div key={dayKey(d)} className="flex min-h-16 items-center gap-1 pr-3">
              <button
                type="button"
                onClick={() => setEditing(d)}
                aria-label={`mudar ${d.label ?? whenText(d, today)}`}
                className="press-row flex min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-left hover:bg-hover"
              >
                {d.yearly ? (
                  <ArrowsClockwise className="size-5 shrink-0 text-muted" aria-hidden />
                ) : (
                  <Clock className="size-5 shrink-0 text-muted" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    <span className="first-letter:uppercase inline-block">
                      {whenText(d, today)}
                    </span>
                    {d.label ? <span className="font-normal text-muted"> · {d.label}</span> : null}
                  </span>
                  <span className="t-caption block text-muted">
                    {d.closed
                      ? d.until
                        ? 'fechado esses dias'
                        : 'fechado o dia todo'
                      : `${hhmm(d.open!)} às ${hhmm(d.close!)}`}
                    {d.yearly ? ' · todo ano' : ''}
                  </span>
                </span>
              </button>
              <IconButton
                label={`tirar ${d.label ?? whenText(d, today)}`}
                size="sm"
                onClick={() => remove(d)}
              >
                <Trash />
              </IconButton>
            </div>
          ))}
        </Card>
      ) : (
        <DuaNote pose="horarios" title="Nenhum dia especial marcado">
          Natal, Ano-Novo, uma folga, as férias: é só adicionar.
        </DuaNote>
      )}
      {holidays.length ? (
        <div className="mt-4">
          <p className="t-label mb-2 px-1">Feriados nacionais que vêm aí</p>
          <div className="scroll-row -mx-4 px-4 md:-mx-0 md:px-0">
            <ul className="flex w-max gap-2 pb-1">
              {holidays.map((h) => (
                <li key={h.date}>
                  <button
                    type="button"
                    onClick={() => addHoliday(h)}
                    aria-label={`fechar no ${h.label}, ${whenText({ date: h.date, closed: true, ...(h.until ? { until: h.until } : {}) }, today)}`}
                    className="press t-label inline-flex min-h-12 items-center gap-2 rounded-full bg-surface pl-3 pr-4 ring-1 ring-line-strong hover:bg-hover"
                  >
                    <Plus className="size-4 shrink-0 text-muted" aria-hidden />
                    {h.label}
                    <span className="font-normal text-muted">
                      {h.until ? `${dayMonth(h.date)}–${dayMonth(h.until)}` : dayMonth(h.date)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="t-caption mt-1 px-1 text-muted">
            Um toque marca a loja fechada nesse dia. Para abrir em outro horário, toque no dia
            depois.
          </p>
        </div>
      ) : null}
      <SpecialDaySheet
        day={editing}
        today={today}
        onClose={() => setEditing(null)}
        onSave={(day, was) => {
          const rest = latest().filter(
            (x) => dayKey(x) !== dayKey(day) && (!was || dayKey(x) !== dayKey(was)),
          );
          return save([...rest, day]).then(() => {
            setEditing(null);
            toast(`${day.label ?? whenText(day, today)} salvo`);
          });
        }}
      />
    </Section>
  );
}

function SpecialDaySheet({
  day,
  today,
  onClose,
  onSave,
}: {
  day: SpecialDay | 'new' | null;
  today: string;
  onClose: () => void;
  /** `was`: the entry being changed, replaced by the new one */
  onSave: (d: SpecialDay, was: SpecialDay | null) => Promise<unknown>;
}) {
  const was = day && day !== 'new' ? day : null;
  const [date, setDate] = useState(today);
  const [many, setMany] = useState(false);
  const [until, setUntil] = useState(today);
  const [closed, setClosed] = useState(true);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('14:00');
  const [yearly, setYearly] = useState(false);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!day) return;
    const d = day === 'new' ? null : day;
    setDate(d?.date ?? today);
    setMany(!!d?.until);
    setUntil(d?.until ?? addDays(d?.date ?? today, 1));
    setClosed(d?.closed ?? true);
    setFrom(d?.open ?? '09:00');
    setTo(d?.close ?? '14:00');
    setYearly(!!d?.yearly);
    setLabel(d?.label ?? '');
  }, [day, today]);
  const span = many ? spanDays(date, until) : 0;
  const problem = !date
    ? 'Escolha a data.'
    : many && (!until || span < 1)
      ? 'O último dia precisa ser depois do primeiro.'
      : span > RANGE_MAX_DAYS
        ? `Dá para marcar até ${RANGE_MAX_DAYS} dias seguidos.`
        : !closed && from >= to
          ? 'O horário de fechar precisa ser depois do de abrir.'
          : null;
  const submit = () => {
    if (problem) return;
    const d: SpecialDay = {
      date,
      closed,
      ...(closed ? {} : { open: from, close: to }),
      ...(many ? { until } : {}),
      ...(yearly ? { yearly: true } : {}),
      ...(label.trim() ? { label: label.trim() } : {}),
    };
    setSaving(true);
    void onSave(d, was)
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };
  return (
    <Sheet
      open={!!day}
      onOpenChange={(v) => !v && onClose()}
      title={was ? 'Mudar dia especial' : 'Dia especial'}
      footer={
        <Button size="lg" block loading={saving} disabled={!!problem} onClick={submit}>
          {many ? 'salvar dias' : 'salvar dia'}
        </Button>
      }
    >
      <div className="space-y-5 pt-2">
        <div className={cn('grid gap-3', many && 'grid-cols-2')}>
          <Field label={many ? 'De' : 'Data'} htmlFor="sd-date">
            <TextInput
              id="sd-date"
              type="date"
              min={yearly ? undefined : today}
              value={date}
              onChange={(e) => {
                const v = e.target.value;
                setDate(v);
                if (v && until <= v) setUntil(addDays(v, 1));
              }}
            />
          </Field>
          {many ? (
            <Field label="Até" htmlFor="sd-until">
              <TextInput
                id="sd-until"
                type="date"
                min={date ? addDays(date, 1) : today}
                max={date ? addDays(date, RANGE_MAX_DAYS) : undefined}
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
          ) : null}
        </div>
        <div className="-mt-2 divide-y divide-line">
          <Toggle
            checked={many}
            onChange={setMany}
            label="Mais de um dia"
            description="Férias, a semana do Natal: do primeiro ao último dia."
          />
          <Toggle
            checked={yearly}
            onChange={setYearly}
            label="Repetir todo ano"
            description={
              yearly
                ? 'Nas mesmas datas, todos os anos.'
                : 'Só desta vez. Para Natal e Ano-Novo, ligue.'
            }
          />
        </div>
        <Chips
          label={many ? 'nesses dias' : 'nesse dia'}
          value={closed ? 'closed' : 'open'}
          onChange={(v) => setClosed(v === 'closed')}
          options={[
            { value: 'closed', label: 'fechado' },
            { value: 'open', label: 'horário diferente' },
          ]}
        />
        {!closed ? (
          <div className="flex items-center gap-3">
            <TimeInput label="abre às" value={from} onCommit={setFrom} />
            <span className="text-muted">às</span>
            <TimeInput label="fecha às" value={to} onCommit={setTo} />
          </div>
        ) : null}
        <Field label="Nome" optional htmlFor="sd-label">
          <TextInput
            id="sd-label"
            maxLength={60}
            placeholder="Ex.: Natal"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        {problem ? (
          <p className="t-body text-danger" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function Delivery({
  s,
  patch,
  run,
}: {
  s: StoreView;
  patch: (b: Record<string, unknown>) => void;
  run: (b: Record<string, unknown>) => Promise<unknown>;
}) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Zone | 'new' | null>(null);
  // an area deleted a moment ago stays off the list while "desfazer" is up; Core hears after
  const { held, hold } = useHeld();
  const zones = s.zones.filter((z) => !held.has(z.id));
  const [locating, setLocating] = useState(false);
  const [finding, setFinding] = useState(false);
  const o = s.operations;
  // a first guess from the store's address; the merchant fixes it with a tap on the map
  const findByAddress = async () => {
    const line = [s.profile.address, s.profile.city].filter(Boolean).join(', ');
    setFinding(true);
    try {
      const { point } = await api.geocode(line);
      if (!point) {
        toast.error('Não achamos esse endereço no mapa. Toque em “marcar loja” e marque à mão.');
        return;
      }
      // saved before it's announced; a failed save already shows its own error
      const saved = await run({ location: { latitude: point.lat, longitude: point.lng } }).then(
        () => true,
        () => false,
      );
      if (!saved) return;
      toast(
        point.precision === 'address'
          ? 'Loja marcada pelo endereço. Confira o pino no mapa.'
          : 'Marcamos perto do endereço. Ajuste o pino tocando em “mudar local”.',
      );
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setFinding(false);
    }
  };
  const neighborhoodZones = zones.filter((z) => z.kind === 'neighborhood');
  return (
    <Section id="entrega" title="Entrega e retirada">
      <Card className="space-y-2 p-5">
        <Toggle
          checked={o.pickupEnabled}
          onChange={(v) => patch({ operations: { pickupEnabled: v } })}
          label="Retirada na loja"
          description={
            o.pickupEnabled
              ? 'O cliente busca o pedido no endereço abaixo.'
              : 'Deixe o cliente buscar o pedido.'
          }
        />
        {o.pickupEnabled ? (
          <div className="animate-fade-up space-y-4 rounded-md p-4 ring-1 ring-line">
            <Field
              label="Onde retirar"
              htmlFor="pk-addr"
              helper="Aparece para quem escolhe retirar, na loja e no pedido."
            >
              <CommitInput
                id="pk-addr"
                maxLength={200}
                autoComplete="off"
                value={o.pickupAddress ?? ''}
                placeholder={s.profile.address ?? 'Ex.: Rua das Flores, 120 — Centro'}
                onCommit={(v) => patch({ operations: { pickupAddress: v || null } })}
              />
            </Field>
            {!o.pickupAddress && s.profile.address ? (
              <Button
                size="sm"
                variant="secondary"
                className="-mt-2"
                onClick={() => patch({ operations: { pickupAddress: s.profile.address } })}
              >
                usar o endereço da loja
              </Button>
            ) : null}
            <Field
              label="Como retirar"
              optional
              htmlFor="pk-how"
              helper="Um recado curto: onde parar, a quem chamar, que horas."
            >
              <CommitInput
                id="pk-how"
                multiline
                maxLength={400}
                value={o.pickupInstructions ?? ''}
                placeholder="Ex.: Toque o interfone da casa 2. Retiradas até as 18h."
                onCommit={(v) => patch({ operations: { pickupInstructions: v || null } })}
              />
            </Field>
          </div>
        ) : null}
        <Toggle
          checked={o.deliveryEnabled}
          onChange={(v) => patch({ operations: { deliveryEnabled: v } })}
          label="Entrega"
          description={
            s.distancePricing.enabled
              ? 'Pela distância até a porta do cliente.'
              : 'Nos bairros ou raio abaixo.'
          }
        />
        {!o.pickupEnabled && !o.deliveryEnabled ? (
          <Notice tone="danger" title="Ninguém consegue pedir" role="alert">
            Com retirada e entrega desligadas, a loja não aceita pedidos. Ligue pelo menos uma das
            duas.
          </Notice>
        ) : null}
        <div className="grid gap-5 border-t border-line pt-4 sm:grid-cols-2">
          <Field label="Tempo de preparo de sempre" helper="Vem marcado ao aceitar um pedido.">
            <SavedStepper
              label="tempo de preparo"
              value={o.prepTimeMinutes}
              min={5}
              max={240}
              step={5}
              suffix=" min"
              onSave={(v) => run({ operations: { prepTimeMinutes: v } }).catch(() => undefined)}
            />
          </Field>
          <Field label="Aceitar pedidos em até" helper="Depois disso o pedido fica em destaque.">
            <SavedStepper
              label="tempo para aceitar"
              value={o.acceptTargetMinutes}
              min={1}
              max={60}
              suffix=" min"
              onSave={(v) => run({ operations: { acceptTargetMinutes: v } }).catch(() => undefined)}
            />
          </Field>
          <Field label="Pedido mínimo" htmlFor="minorder" helper="Deixe vazio para não ter mínimo.">
            <MoneyField
              id="minorder"
              allowEmpty
              cents={o.minOrderCents || null}
              onCommit={(v) => patch({ operations: { minOrderCents: v ?? 0 } })}
            />
          </Field>
        </div>
      </Card>

      {o.deliveryEnabled ? (
        <div className="mt-4 space-y-4">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1 basis-60">
                <p className="font-semibold">Área de entrega</p>
                <p className="t-caption text-muted">
                  {!s.location
                    ? 'Marque onde fica a loja para entregar por distância.'
                    : s.distancePricing.enabled
                      ? 'O pino da loja é de onde a distância é medida.'
                      : 'Os círculos e as áreas desenhadas mostram até onde vai cada taxa.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {s.profile.address && !locating ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<MagnifyingGlass />}
                    loading={finding}
                    onClick={() => void findByAddress()}
                  >
                    pelo endereço
                  </Button>
                ) : null}
                <Button
                  variant={locating ? 'primary' : 'secondary'}
                  size="sm"
                  icon={<Crosshair />}
                  onClick={() => setLocating((v) => !v)}
                >
                  {locating ? 'toque no mapa' : s.location ? 'mudar local' : 'marcar loja'}
                </Button>
              </div>
            </div>
            <Suspense fallback={<div className="skeleton h-72" />}>
              <ZoneMap
                center={s.location}
                zones={zones}
                className="h-72 w-full"
                onPick={
                  locating
                    ? (loc) => {
                        setLocating(false);
                        patch({ location: loc });
                        toast('Local da loja salvo');
                      }
                    : undefined
                }
              />
            </Suspense>
          </Card>
          <DistancePricing s={s} patch={patch} run={run} />
          {s.distancePricing.enabled ? (
            <div className="px-1 pt-2">
              <p className="font-semibold">Áreas de reserva</p>
              <p className="t-caption text-muted">
                Valem só quando o endereço chega sem o local no mapa.
              </p>
            </div>
          ) : null}
          <Card className="divide-y divide-line">
            {zones.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => setEdit(z)}
                className="flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
              >
                {z.kind === 'radius' ? (
                  <MapPin className="size-6 shrink-0 text-muted" />
                ) : z.kind === 'polygon' ? (
                  <Polygon className="size-6 shrink-0 text-muted" />
                ) : (
                  <Moped className="size-6 shrink-0 text-muted" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {z.name}
                    {!z.active ? (
                      <span className="t-caption ml-2 text-muted">(pausada)</span>
                    ) : null}
                  </span>
                  <span className="t-caption block truncate text-muted">
                    {z.kind === 'radius'
                      ? `até ${z.maxDistanceKm} km`
                      : z.kind === 'polygon'
                        ? 'desenhada no mapa'
                        : z.neighborhoods.join(', ')}{' '}
                    · {z.etaMin}–{z.etaMax} min
                  </span>
                </span>
                <span className="tnum shrink-0 text-right">
                  <span className="block font-semibold">
                    {z.feeCents ? money(z.feeCents) : 'grátis'}
                  </span>
                  {z.freeDeliveryOverCents ? (
                    <span className="t-caption text-muted">
                      grátis acima de {money(z.freeDeliveryOverCents)}
                    </span>
                  ) : null}
                </span>
                <PencilSimple className="size-5 shrink-0 text-muted" />
              </button>
            ))}
            <div className="p-3">
              <Button variant="ghost" block icon={<Plus />} onClick={() => setEdit('new')}>
                nova área de entrega
              </Button>
            </div>
          </Card>
          {neighborhoodZones.length ? (
            <p className="t-caption px-1 text-muted">
              Áreas por bairro valem pelo nome do bairro que o cliente informa.
            </p>
          ) : null}
        </div>
      ) : null}
      <ZoneSheet
        zone={edit}
        center={s.location}
        zones={zones}
        hasLocation={!!s.location}
        onClose={() => setEdit(null)}
        onSaved={() => void qc.invalidateQueries({ queryKey: qk.store })}
        onDelete={(z) => {
          setEdit(null);
          hold(
            z.id,
            `Área “${z.name}” apagada`,
            (leaving) =>
              void api.deleteZone(z.id, { keepalive: leaving }).then(
                () => qc.invalidateQueries({ queryKey: qk.store }),
                (e) => {
                  toast.error(messageOf(e));
                  void qc.invalidateQueries({ queryKey: qk.store });
                },
              ),
          );
        }}
      />
    </Section>
  );
}

const FEE_MAX = 100_000;
const feeRule = (c: number) => (c > FEE_MAX ? `Até ${money(FEE_MAX)}.` : null);

/** ADR 0024: base + R$/started km from the store's pin, Core computes every fee. */
function DistancePricing({
  s,
  patch,
  run,
}: {
  s: StoreView;
  patch: (b: Record<string, unknown>) => void;
  run: (b: Record<string, unknown>) => Promise<unknown>;
}) {
  const d = s.distancePricing;
  const set = (p: Partial<StoreView['distancePricing']>) => patch({ distancePricing: p });
  const rule = [
    `${money(d.baseFeeCents)} de saída`,
    d.feePerKmCents ? `mais ${money(d.feePerKmCents)} por km` : null,
    d.minFeeCents ? `no mínimo ${money(d.minFeeCents)}` : null,
    `até ${d.maxKm.toLocaleString('pt-BR')} km`,
    d.freeOverCents ? `grátis em pedidos a partir de ${money(d.freeOverCents)}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Card className="space-y-2 p-5">
      <Toggle
        checked={d.enabled}
        disabled={!s.location && !d.enabled}
        onChange={(v) => set({ enabled: v })}
        label="Cobrar pela distância"
        description={
          !s.location
            ? 'Marque a loja no mapa acima para cobrar pela distância.'
            : 'O cliente confirma no mapa onde entregar, e a taxa sai pelo caminho de carro da loja até lá.'
        }
      />
      {d.enabled ? (
        <div className="animate-fade-up space-y-4 rounded-md p-4 ring-1 ring-line">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Taxa de saída" htmlFor="dp-base" helper="Cobrada em toda entrega.">
              <MoneyField
                id="dp-base"
                cents={d.baseFeeCents}
                validate={feeRule}
                onCommit={(v) => set({ baseFeeCents: v ?? 0 })}
              />
            </Field>
            <Field label="Por km" htmlFor="dp-km" helper="Cada km começado conta inteiro.">
              <MoneyField
                id="dp-km"
                cents={d.feePerKmCents}
                validate={feeRule}
                onCommit={(v) => set({ feePerKmCents: v ?? 0 })}
              />
            </Field>
            <Field
              label="Taxa mínima"
              optional
              htmlFor="dp-min"
              helper="Nenhuma entrega sai por menos que isso."
            >
              <MoneyField
                id="dp-min"
                allowEmpty
                cents={d.minFeeCents || null}
                validate={feeRule}
                onCommit={(v) => set({ minFeeCents: v ?? 0 })}
              />
            </Field>
            <Field
              label="Grátis acima de"
              optional
              htmlFor="dp-free"
              helper="Pedidos a partir desse valor não pagam entrega."
            >
              <MoneyField
                id="dp-free"
                allowEmpty
                cents={d.freeOverCents}
                onCommit={(v) => set({ freeOverCents: v })}
              />
            </Field>
            <Field label="Entrega até" helper="Mais longe que isso, a loja não entrega.">
              <SavedStepper
                label="distância máxima"
                value={d.maxKm}
                min={1}
                max={50}
                suffix=" km"
                onSave={(v) => run({ distancePricing: { maxKm: v } }).catch(() => undefined)}
              />
            </Field>
          </div>
          <p className="t-caption text-muted">
            A entrega fica em {rule}. Sem caminho de carro disponível na hora, a distância em linha
            reta conta com 30% a mais.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

const POLYGON_MAX = 200;
type Ring = [number, number][];

function ZoneSheet({
  zone,
  center,
  zones,
  hasLocation,
  onClose,
  onSaved,
  onDelete,
}: {
  zone: Zone | 'new' | null;
  center: StoreView['location'];
  zones: Zone[];
  hasLocation: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** held behind "desfazer" by the section */
  onDelete: (z: Zone) => void;
}) {
  const isNew = zone === 'new';
  const z = zone && zone !== 'new' ? zone : null;
  const [kind, setKind] = useState<Zone['kind']>('neighborhood');
  const [poly, setPoly] = useState<Ring>([]);
  // each change keeps the shape before it, so "desfazer" also undoes a drag
  const [history, setHistory] = useState<Ring[]>([]);
  const changePoly = (next: Ring) => {
    setHistory((h) => [...h.slice(-49), poly]);
    setPoly(next);
  };
  const [name, setName] = useState('');
  const [hoods, setHoods] = useState('');
  const [km, setKm] = useState(3);
  const [fee, setFee] = useState<number | null>(500);
  const [free, setFree] = useState<number | null>(null);
  const [min, setMin] = useState<number | null>(null);
  const [eta, setEta] = useState<[number, number]>([30, 60]);
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (!zone) return;
    setKind(z?.kind ?? (hasLocation ? 'radius' : 'neighborhood'));
    setName(z?.name ?? '');
    setHoods(z?.neighborhoods.join(', ') ?? '');
    setPoly(z?.polygon ?? []);
    setHistory([]);
    setKm(z?.maxDistanceKm ?? 3);
    setFee(z?.feeCents ?? 500);
    setFree(z?.freeDeliveryOverCents ?? null);
    setMin(z?.minOrderCents || null);
    setEta([z?.etaMin ?? 30, z?.etaMax ?? 60]);
    setActive(z?.active ?? true);
  }, [zone, z, hasLocation]);
  const body = () => ({
    name:
      name.trim() ||
      (kind === 'radius'
        ? `Até ${km} km`
        : kind === 'polygon'
          ? 'Área desenhada'
          : hoods.split(',')[0]?.trim() || 'Entrega'),
    kind,
    ...(kind === 'neighborhood'
      ? {
          neighborhoods: hoods
            .split(/[,\n]/)
            .map((h) => h.trim())
            .filter(Boolean),
        }
      : kind === 'polygon'
        ? { polygon: poly, neighborhoods: [] }
        : { maxDistanceKm: km, neighborhoods: [] }),
    feeCents: fee ?? 0,
    freeDeliveryOverCents: free,
    minOrderCents: min ?? 0,
    etaMin: eta[0],
    etaMax: eta[1],
    active,
  });
  const save = useMutation({
    mutationFn: () => (isNew ? api.createZone(body()) : api.updateZone(z!.id, body())),
    onSuccess: () => {
      onSaved();
      onClose();
      toast('Área de entrega salva');
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.field === 'polygon'
          ? 'Desenhe a área com pelo menos 3 pontos (até 200) que não fiquem em linha reta.'
          : messageOf(e),
      ),
  });
  return (
    <Sheet
      open={!!zone}
      onOpenChange={(v) => !v && onClose()}
      title={isNew ? 'Nova área de entrega' : (z?.name ?? '')}
      footer={
        <div className="flex gap-2">
          {!isNew ? (
            <Button
              variant="ghost"
              className="text-danger!"
              icon={<Trash />}
              onClick={() => onDelete(z!)}
            >
              apagar
            </Button>
          ) : null}
          <Button
            size="lg"
            block
            loading={save.isPending}
            disabled={kind === 'polygon' && (poly.length < 3 || poly.length > POLYGON_MAX)}
            onClick={() => save.mutate()}
          >
            salvar área
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pt-2">
        <Chips
          label="tipo de área"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'neighborhood', label: 'por bairro' },
            { value: 'radius', label: 'por distância' },
            { value: 'polygon', label: 'desenhar no mapa' },
          ]}
        />
        {kind === 'radius' && !hasLocation ? (
          <p className="t-body rounded-md bg-warning-soft p-3 text-warning">
            Para entregar por distância, marque antes onde fica a loja no mapa.
          </p>
        ) : null}
        <Field label="Nome" optional htmlFor="z-name">
          <TextInput
            id="z-name"
            maxLength={80}
            placeholder={kind === 'radius' ? 'Ex.: Perto da loja' : 'Ex.: Centro e vizinhos'}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {kind === 'polygon' ? (
          <PolygonField
            ring={poly}
            onChange={changePoly}
            canUndo={history.length > 0}
            onUndo={() => {
              setPoly(history.at(-1) ?? []);
              setHistory((h) => h.slice(0, -1));
            }}
            center={center}
            others={zones.filter((x) => x.id !== z?.id)}
          />
        ) : kind === 'neighborhood' ? (
          <Field label="Bairros" htmlFor="z-hoods" helper="Separe por vírgula.">
            <TextArea
              id="z-hoods"
              value={hoods}
              onChange={(e) => setHoods(e.target.value)}
              placeholder="Centro, Bacaxá, Porto da Roça"
              className="min-h-20"
            />
          </Field>
        ) : (
          <Field label="Até quantos km">
            <Stepper
              label="distância máxima"
              value={km}
              min={1}
              max={50}
              suffix=" km"
              onChange={setKm}
            />
          </Field>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Taxa de entrega" htmlFor="z-fee" helper="0 = grátis.">
            <MoneyField id="z-fee" cents={fee} onCommit={setFee} />
          </Field>
          <Field label="Grátis acima de" optional htmlFor="z-free">
            <MoneyField id="z-free" allowEmpty cents={free} onCommit={setFree} />
          </Field>
          <Field label="Pedido mínimo" optional htmlFor="z-min">
            <MoneyField id="z-min" allowEmpty cents={min} onCommit={setMin} />
          </Field>
        </div>
        <Field label="Tempo de entrega">
          <div className="flex flex-wrap items-center gap-2">
            <Stepper
              label="tempo mínimo"
              value={eta[0]}
              min={5}
              max={eta[1]}
              step={5}
              suffix=" min"
              onChange={(v) => setEta([v, eta[1]])}
            />
            <span className="text-muted">a</span>
            <Stepper
              label="tempo máximo"
              value={eta[1]}
              min={eta[0]}
              max={240}
              step={5}
              suffix=" min"
              onChange={(v) => setEta([eta[0], v])}
            />
          </div>
        </Field>
        <Toggle
          checked={active}
          onChange={setActive}
          label="Ativa"
          description="Desligue para parar de entregar aqui sem apagar."
        />
      </div>
    </Sheet>
  );
}

function PolygonField({
  ring,
  onChange,
  canUndo,
  onUndo,
  center,
  others,
}: {
  ring: Ring;
  onChange: (r: Ring) => void;
  canUndo: boolean;
  onUndo: () => void;
  center: StoreView['location'];
  others: Zone[];
}) {
  const need = 3 - ring.length;
  return (
    <div className="space-y-2">
      <p className="t-label">Área no mapa</p>
      <p className="t-caption text-muted">
        Toque no mapa para marcar os cantos da área, em volta. Arraste um ponto para ajustar.
      </p>
      <Suspense fallback={<div className="skeleton h-72 rounded-lg" />}>
        <ZoneMap
          center={center}
          zones={others}
          polygon={ring}
          onPolygonChange={onChange}
          className="h-72 w-full overflow-hidden rounded-lg ring-1 ring-line"
        />
      </Suspense>
      <div className="flex flex-wrap items-center gap-2">
        <p
          className={cn('t-caption mr-auto', need > 0 ? 'text-warning' : 'text-muted')}
          aria-live="polite"
        >
          {need > 0
            ? `${ring.length} de 3 pontos: falta${need > 1 ? 'm' : ''} ${need}`
            : `${ring.length} pontos${ring.length >= POLYGON_MAX ? ' (o máximo)' : ''}`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowCounterClockwise />}
          disabled={!canUndo}
          onClick={onUndo}
        >
          desfazer
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash />}
          disabled={!ring.length}
          onClick={() => onChange([])}
        >
          limpar
        </Button>
      </div>
      <p className="t-caption text-muted">
        Vale pela localização do endereço do cliente. Se o bairro dele estiver numa área por bairro,
        essa vale primeiro.
      </p>
    </div>
  );
}

const CONTACT_ERROR = {
  whatsapp: 'Use o DDD e o número, como (22) 98179-5040.',
  instagram: 'Use o @ da loja ou o link do perfil.',
};

function Profile({
  s,
  patch,
  run,
}: {
  s: StoreView;
  patch: (b: Record<string, unknown>) => void;
  run: (b: Record<string, unknown>) => Promise<StoreView>;
}) {
  const p = s.profile;
  const [waDraft, setWaDraft] = useState(phone(p.whatsapp));
  const [waErr, setWaErr] = useState<string | null>(null);
  const [igErr, setIgErr] = useState<string | null>(null);
  useEffect(() => setWaDraft(phone(p.whatsapp)), [p.whatsapp]);
  // Core normalises both and refuses what it can't read; the Kernel's same rule answers first
  const contact = (field: 'whatsapp' | 'instagram', v: string | null) =>
    void run({ profile: { [field]: v } }).then(
      () => (field === 'whatsapp' ? setWaErr : setIgErr)(null),
      (e) => {
        if (e instanceof ApiError && e.field === field)
          (field === 'whatsapp' ? setWaErr : setIgErr)(CONTACT_ERROR[field]);
      },
    );
  return (
    <Section id="perfil" title="Perfil" hint="Como a loja se apresenta.">
      <Card className="space-y-5 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="w-28 shrink-0">
            <PhotoField
              label="logo da loja"
              aspect="1:1"
              max={1}
              photos={p.logoUrl ? [{ url: p.logoUrl }] : []}
              onChange={(next) => run({ profile: { logoUrl: next[0]?.url ?? null } })}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <Field label="Nome da loja" htmlFor="pf-name">
              <CommitInput
                id="pf-name"
                maxLength={80}
                value={p.name}
                onCommit={(v) => patch({ profile: { name: v } })}
                validate={(v) =>
                  v.trim().length < 2 ? 'O nome precisa de pelo menos 2 letras.' : null
                }
              />
            </Field>
            <Field label="Frase curta" optional htmlFor="pf-tag">
              <CommitInput
                id="pf-tag"
                maxLength={120}
                value={p.tagline ?? ''}
                placeholder="Ex.: Pudins sem furinhos"
                onCommit={(v) => patch({ profile: { tagline: v || null } })}
              />
            </Field>
          </div>
        </div>
        <Field label="Sobre a loja" optional htmlFor="pf-desc">
          <CommitInput
            id="pf-desc"
            multiline
            maxLength={1000}
            value={p.description ?? ''}
            onCommit={(v) => patch({ profile: { description: v || null } })}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="WhatsApp da loja" htmlFor="pf-wa" error={waErr}>
            <TextInput
              id="pf-wa"
              type="tel"
              inputMode="tel"
              value={waDraft}
              aria-invalid={!!waErr || undefined}
              onChange={(e) => setWaDraft(e.target.value)}
              onBlur={() => {
                const raw = waDraft.trim();
                const d = raw ? whatsappDigits(raw) : null;
                if (raw && !d) return setWaErr(CONTACT_ERROR.whatsapp);
                setWaErr(null);
                if (d !== (p.whatsapp ?? null)) contact('whatsapp', d);
              }}
            />
          </Field>
          <Field label="Instagram" optional htmlFor="pf-ig" error={igErr}>
            <CommitInput
              id="pf-ig"
              maxLength={60}
              value={p.instagram ? `@${p.instagram}` : ''}
              placeholder="@sualoja"
              validate={(v) => (v && !instagramHandle(v) ? CONTACT_ERROR.instagram : null)}
              onCommit={(v) => contact('instagram', v || null)}
            />
          </Field>
          <Field label="E-mail" optional htmlFor="pf-mail">
            <CommitInput
              id="pf-mail"
              type="email"
              maxLength={200}
              value={p.email ?? ''}
              onCommit={(v) => patch({ profile: { email: v || null } })}
            />
          </Field>
          <Field label="Cidade" optional htmlFor="pf-city">
            <CommitInput
              id="pf-city"
              maxLength={80}
              value={p.city ?? ''}
              onCommit={(v) => patch({ profile: { city: v || null } })}
            />
          </Field>
        </div>
        <Field label="Endereço da loja" optional htmlFor="pf-addr">
          <CommitInput
            id="pf-addr"
            maxLength={300}
            value={p.address ?? ''}
            onCommit={(v) => patch({ profile: { address: v || null } })}
          />
        </Field>
      </Card>
      <p className="t-caption mt-2 flex items-center gap-1.5 px-1 text-muted">
        <Storefront className="size-4" /> Mudanças no perfil aparecem na loja na hora.
      </p>
    </Section>
  );
}
