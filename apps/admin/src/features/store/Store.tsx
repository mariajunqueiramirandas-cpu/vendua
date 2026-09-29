import {
  CalendarPlus,
  Clock,
  Crosshair,
  Fire,
  MapPin,
  Moped,
  PencilSimple,
  Plus,
  Storefront,
  Trash,
} from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { api, type SpecialDay, type StoreView, type Zone } from '../../lib/api.ts';
import { useAutosave } from '../../lib/autosave.ts';
import { dateShort, hhmm, isoDate, money, phone, waDigits } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { ErrorState, Loading, messageOf } from '../../ui/feedback.tsx';
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
import { PhotoField } from '../../ui/PhotoField.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { fromWeek, TimeRangeField, toWeek, type WeekModel } from '../../ui/TimeRangeField.tsx';
import { toast } from '../../ui/Toast.tsx';
import { StatusPill, useStoreQuery } from './StatusPill.tsx';

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
        <Loading />
      </PageBody>
    );
  return <StoreEditor s={data} />;
}

function useStorePatch() {
  const qc = useQueryClient();
  const save = useSaveState();
  const run = (body: Record<string, unknown>) =>
    save
      .track(api.updateStore(body))
      .then((s) => {
        qc.setQueryData(qk.store, s);
        void qc.invalidateQueries({ queryKey: qk.home });
        void qc.invalidateQueries({ queryKey: qk.session });
        return s;
      })
      .catch((e) => {
        toast.error(messageOf(e));
        throw e;
      });
  return { run, state: save.state };
}

function StoreEditor({ s }: { s: StoreView }) {
  const { run, state } = useStorePatch();
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
          <Hours s={s} />
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

function Hours({ s }: { s: StoreView }) {
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
    </Section>
  );
}

function SpecialDays({
  s,
  run,
}: {
  s: StoreView;
  run: (b: Record<string, unknown>) => Promise<StoreView>;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(isoDate(new Date()));
  const [closed, setClosed] = useState(true);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('14:00');
  const [label, setLabel] = useState('');
  const today = isoDate(new Date(), s.hours.timezone);
  const upcoming = s.specialDays.filter((d) => d.date >= today);
  const add = () => {
    const day: SpecialDay = closed
      ? { date, closed: true, ...(label.trim() ? { label: label.trim() } : {}) }
      : {
          date,
          closed: false,
          open: from,
          close: to,
          ...(label.trim() ? { label: label.trim() } : {}),
        };
    void run({ specialDays: [...s.specialDays.filter((d) => d.date !== date), day] }).then(() => {
      setOpen(false);
      setLabel('');
      toast(`${dateShort(date)} salvo`);
    });
  };
  return (
    <Section
      title="Feriados e dias especiais"
      hint="Um dia fechado ou com horário diferente, sem mexer na semana."
      action={
        <Button variant="secondary" size="sm" icon={<CalendarPlus />} onClick={() => setOpen(true)}>
          adicionar
        </Button>
      }
    >
      {upcoming.length ? (
        <Card className="divide-y divide-line">
          {upcoming.map((d) => (
            <div key={d.date} className="flex min-h-16 items-center gap-3 px-4 py-2">
              <Clock className="size-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold capitalize">
                  {dateShort(d.date)}
                  {d.label ? <span className="font-normal text-muted"> · {d.label}</span> : null}
                </p>
                <p className="t-caption text-muted">
                  {d.closed ? 'fechado o dia todo' : `${hhmm(d.open!)} às ${hhmm(d.close!)}`}
                </p>
              </div>
              <IconButton
                label={`tirar ${dateShort(d.date)}`}
                size="sm"
                onClick={() =>
                  void run({ specialDays: s.specialDays.filter((x) => x.date !== d.date) })
                }
              >
                <Trash />
              </IconButton>
            </div>
          ))}
        </Card>
      ) : (
        <Card className="p-5 text-muted">
          <p className="t-body">
            Nenhum dia especial marcado. Natal, Ano-Novo, uma folga: é só adicionar.
          </p>
        </Card>
      )}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Dia especial"
        footer={
          <Button size="lg" block onClick={add}>
            salvar dia
          </Button>
        }
      >
        <div className="space-y-5 pt-2">
          <Field label="Data" htmlFor="sd-date">
            <TextInput
              id="sd-date"
              type="date"
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Chips
            label="nesse dia"
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
        </div>
      </Sheet>
    </Section>
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
  const [locating, setLocating] = useState(false);
  const o = s.operations;
  const neighborhoodZones = s.zones.filter((z) => z.kind === 'neighborhood');
  return (
    <Section id="entrega" title="Entrega e retirada">
      <Card className="space-y-2 p-5">
        <Toggle
          checked={o.pickupEnabled}
          onChange={(v) => patch({ operations: { pickupEnabled: v } })}
          label="Retirada na loja"
          description={s.profile.address ?? 'O cliente busca o pedido.'}
        />
        <Toggle
          checked={o.deliveryEnabled}
          onChange={(v) => patch({ operations: { deliveryEnabled: v } })}
          label="Entrega"
          description="Nos bairros ou raio abaixo."
        />
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
            <div className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">Área de entrega</p>
                <p className="t-caption text-muted">
                  {s.location
                    ? 'Os círculos mostram até onde vai cada taxa.'
                    : 'Marque onde fica a loja para entregar por distância.'}
                </p>
              </div>
              <Button
                variant={locating ? 'primary' : 'secondary'}
                size="sm"
                icon={<Crosshair />}
                onClick={() => setLocating((v) => !v)}
              >
                {locating ? 'toque no mapa' : s.location ? 'mudar local' : 'marcar loja'}
              </Button>
            </div>
            <Suspense fallback={<div className="skeleton h-72" />}>
              <ZoneMap
                center={s.location}
                zones={s.zones}
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
          <Card className="divide-y divide-line">
            {s.zones.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => setEdit(z)}
                className="flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
              >
                {z.kind === 'radius' ? (
                  <MapPin className="size-6 shrink-0 text-muted" />
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
                    {z.kind === 'radius' ? `até ${z.maxDistanceKm} km` : z.neighborhoods.join(', ')}{' '}
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
        hasLocation={!!s.location}
        onClose={() => setEdit(null)}
        onSaved={() => void qc.invalidateQueries({ queryKey: qk.store })}
      />
    </Section>
  );
}

function ZoneSheet({
  zone,
  hasLocation,
  onClose,
  onSaved,
}: {
  zone: Zone | 'new' | null;
  hasLocation: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = zone === 'new';
  const z = zone && zone !== 'new' ? zone : null;
  const [kind, setKind] = useState<'neighborhood' | 'radius'>('neighborhood');
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
      (kind === 'radius' ? `Até ${km} km` : hoods.split(',')[0]?.trim() || 'Entrega'),
    kind,
    ...(kind === 'neighborhood'
      ? {
          neighborhoods: hoods
            .split(/[,\n]/)
            .map((h) => h.trim())
            .filter(Boolean),
        }
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
    onError: (e) => toast.error(messageOf(e)),
  });
  const del = useMutation({
    mutationFn: () => api.deleteZone(z!.id),
    onSuccess: () => {
      onSaved();
      onClose();
      toast('Área apagada');
    },
    onError: (e) => toast.error(messageOf(e)),
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
              className="text-danger"
              icon={<Trash />}
              loading={del.isPending}
              onClick={() => del.mutate()}
            >
              apagar
            </Button>
          ) : null}
          <Button size="lg" block loading={save.isPending} onClick={() => save.mutate()}>
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
        {kind === 'neighborhood' ? (
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
  useEffect(() => setWaDraft(phone(p.whatsapp)), [p.whatsapp]);
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
          <Field label="WhatsApp da loja" htmlFor="pf-wa">
            <TextInput
              id="pf-wa"
              type="tel"
              inputMode="tel"
              value={waDraft}
              onChange={(e) => setWaDraft(e.target.value)}
              onBlur={() => {
                const d = waDigits(waDraft);
                if (d !== (p.whatsapp ?? null)) patch({ profile: { whatsapp: d } });
              }}
            />
          </Field>
          <Field label="Instagram" optional htmlFor="pf-ig">
            <CommitInput
              id="pf-ig"
              maxLength={60}
              value={p.instagram ?? ''}
              placeholder="@sualoja"
              onCommit={(v) => patch({ profile: { instagram: v || null } })}
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
        <Field label="Endereço para retirada" optional htmlFor="pf-addr">
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
