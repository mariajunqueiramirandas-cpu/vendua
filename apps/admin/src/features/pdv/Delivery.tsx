import { MapPinLine, Moped, PencilSimple, UserCircleCheck } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, type PdvCustomer, type PdvDeliveryIn, type PdvQuote } from '../../lib/api.ts';
import { money, phone as phoneText } from '../../lib/format.ts';
import { parsePhone } from '../../lib/parse.ts';
import { qk } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { Field, MoneyField, PhoneInput, TextArea, TextInput } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { useDebounced } from './data.ts';

// A phone order: who asked (the phone first, which brings back a returning customer's name and
// last address) and where it goes. The fee, the zone and the time are Core's, from the quote.

export interface Address {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  reference: string;
  /** as typed, masked 00000-000 */
  cep: string;
  /** the last order's pin, kept while the address is the same */
  pin: { lat: number; lng: number } | null;
}
export const NO_ADDRESS: Address = {
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  reference: '',
  cep: '',
  pin: null,
};

export interface Who {
  name: string;
  phone: string;
  digits: string | null;
  notes: string;
}

export const cepDigits = (cep: string) => cep.replace(/\D/g, '');
const maskCep = (v: string) => {
  const d = cepDigits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

export const addressDone = (a: Address) => !!a.street.trim() && !!a.neighborhood.trim();
export const whoDone = (c: Who) => c.name.trim().length >= 2 && !!c.digits;

export function addressLine(a: Address) {
  const street = [a.street.trim(), a.number.trim()].filter(Boolean).join(', ');
  return [street, a.complement.trim(), a.neighborhood.trim()].filter(Boolean).join(' · ');
}

/** What POST /pdv/quote and /pdv/sales take for this address (null until it has street and bairro). */
export function deliveryIn(
  a: Address,
  pin: { lat: number; lng: number } | null,
  feeCents: number | null,
): PdvDeliveryIn | null {
  if (!addressDone(a)) return null;
  const t = (v: string, max: number) => v.trim().replace(/\s+/g, ' ').slice(0, max);
  const cep = cepDigits(a.cep);
  return {
    street: t(a.street, 120),
    ...(a.number.trim() ? { number: t(a.number, 10) } : {}),
    ...(a.complement.trim() ? { complement: t(a.complement, 80) } : {}),
    neighborhood: t(a.neighborhood, 80),
    ...(a.reference.trim() ? { reference: t(a.reference, 120) } : {}),
    ...(cep.length === 8 ? { cep } : {}),
    ...(pin ? { lat: pin.lat, lng: pin.lng } : {}),
    ...(feeCents !== null ? { feeCents } : {}),
  };
}

/**
 * Stores that price by distance (or draw zones on the map) need a pin: the admin's geocoder
 * gives an approximate one once the address is saved, never per keystroke.
 */
export function useDeliveryPin(a: Address, on: boolean) {
  const store = useQuery({
    queryKey: qk.store,
    queryFn: api.store,
    staleTime: 5 * 60_000,
    enabled: on,
  });
  const needsPin =
    !!store.data &&
    (store.data.distancePricing.enabled ||
      store.data.zones.some((z) => z.active && z.kind !== 'neighborhood'));
  const ask = useMemo(
    () => ({
      street: a.street.trim(),
      number: a.number.trim(),
      neighborhood: a.neighborhood.trim(),
      cep: cepDigits(a.cep).length === 8 ? cepDigits(a.cep) : '',
    }),
    [a.street, a.number, a.neighborhood, a.cep],
  );
  const geo = useQuery({
    queryKey: qk.pdvGeocode(JSON.stringify(ask)),
    queryFn: () => api.pdv.geocode(ask),
    enabled: on && needsPin && addressDone(a) && !a.pin,
    staleTime: Infinity,
    retry: 1,
  });
  const pin =
    a.pin ?? (geo.data?.point ? { lat: geo.data.point.lat, lng: geo.data.point.lng } : null);
  return {
    pin,
    /** the quote waits for this: the store's settings, then the pin */
    waiting: on && addressDone(a) && (store.isPending || (needsPin && !pin && geo.isFetching)),
    /** looked and found nothing */
    missed: needsPin && !a.pin && geo.isSuccess && !geo.data.point,
  };
}

// ── the card on the ticket ─────────────────────────────────────────────────

export function DeliveryCard({
  who,
  address,
  quote,
  fresh,
  outOfZone,
  missedPin,
  manager,
  feeCents,
  onFee,
  onEdit,
}: {
  who: Who;
  address: Address;
  quote: PdvQuote | null;
  fresh: boolean;
  outOfZone: boolean;
  missedPin: boolean;
  manager: boolean;
  feeCents: number | null;
  onFee: (cents: number | null) => void;
  onEdit: () => void;
}) {
  const feeId = useId();
  const [typing, setTyping] = useState(false);
  const empty = !who.digits && !who.name.trim() && !addressDone(address);
  const d = quote?.delivery ?? null;
  const facts = d
    ? [
        d.zoneName,
        d.etaMin !== null
          ? d.etaMax !== null && d.etaMax !== d.etaMin
            ? `${d.etaMin}–${d.etaMax} min`
            : `${d.etaMin} min`
          : null,
        d.distanceKm !== null
          ? `${d.distanceKm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`
          : null,
      ].filter(Boolean)
    : [];
  const showFee = manager && (outOfZone || feeCents !== null || typing);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onEdit}
        aria-haspopup="dialog"
        className={cn(
          'press flex w-full items-start gap-3 rounded-md p-3 text-left ring-1',
          empty
            ? 'bg-spark-soft ring-primary'
            : outOfZone
              ? 'bg-danger-soft ring-danger'
              : 'bg-sunken ring-transparent hover:ring-line-strong',
        )}
      >
        <Moped weight="duotone" className="mt-0.5 size-6 shrink-0" aria-hidden />
        {empty ? (
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Quem pediu e onde entregar</span>
            <span className="t-caption block text-muted">
              Toque para pôr o celular, o nome e o endereço.
            </span>
          </span>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">
              {who.name.trim() || 'Falta o nome'}
            </span>
            {who.digits ? (
              <span className="t-caption tnum block text-muted">{phoneText(who.digits)}</span>
            ) : null}
            <span
              className={cn(
                't-caption line-clamp-2 block',
                addressDone(address) ? 'text-muted' : 'font-semibold text-danger',
              )}
            >
              {addressDone(address) ? addressLine(address) : 'Falta o endereço'}
            </span>
            {outOfZone ? (
              <span className="t-caption mt-0.5 block font-semibold text-danger" role="alert">
                Nenhuma zona de entrega da loja atende esse endereço.
              </span>
            ) : facts.length ? (
              <span className={cn('t-caption mt-0.5 block font-semibold', !fresh && 'opacity-45')}>
                {facts.join(' · ')}
              </span>
            ) : null}
            {/* without a pin only the neighborhood zones can take it */}
            {missedPin && outOfZone ? (
              <span className="t-caption mt-0.5 block text-ink">
                Não achamos esse endereço no mapa. Confira a rua e o número.
              </span>
            ) : null}
          </span>
        )}
        <span className="t-caption inline-flex shrink-0 items-center gap-1 pt-0.5 font-semibold text-muted">
          <PencilSimple weight="bold" className="size-3.5" aria-hidden />
          {empty ? '' : 'mudar'}
        </span>
      </button>

      {outOfZone && !manager ? (
        <p className="t-caption px-1 text-muted">
          Confira o bairro, ou peça a quem é gerente para digitar a taxa de entrega.
        </p>
      ) : null}

      {showFee ? (
        <div className="rounded-md bg-sunken p-3">
          <Field
            label="Taxa de entrega digitada"
            htmlFor={feeId}
            helper={
              outOfZone && feeCents === null
                ? 'Fora das zonas: digite a taxa combinada com o cliente.'
                : 'Vale só para este pedido, no lugar da taxa da zona.'
            }
          >
            <MoneyField
              id={feeId}
              cents={feeCents}
              allowEmpty
              autoFocus={typing}
              validate={(v) => (v > 100000 ? `No máximo ${money(100000)}.` : null)}
              onCommit={onFee}
            />
          </Field>
          {feeCents !== null || typing ? (
            <button
              type="button"
              onClick={() => {
                setTyping(false);
                onFee(null);
              }}
              className="t-caption mt-1 min-h-11 font-semibold underline underline-offset-2"
            >
              usar a taxa das zonas
            </button>
          ) : null}
        </div>
      ) : manager && addressDone(address) ? (
        <button
          type="button"
          onClick={() => setTyping(true)}
          className="t-caption min-h-11 px-1 font-semibold text-muted underline underline-offset-2 hover:text-ink"
        >
          digitar a taxa de entrega
        </button>
      ) : null}
    </div>
  );
}

// ── the sheet: phone first, then name and address ──────────────────────────

const FIELD_ERRORS: Record<string, string> = {
  'customer.name': 'Digite o nome de quem pediu (pelo menos 2 letras).',
  'customer.phone': 'Digite o celular com DDD, como (22) 99999-0000.',
  'delivery.street': 'Digite a rua.',
  'delivery.number': 'O número vai até 10 caracteres.',
  'delivery.complement': 'O complemento vai até 80 caracteres.',
  'delivery.neighborhood': 'Digite o bairro.',
  'delivery.reference': 'A referência vai até 120 caracteres.',
  'delivery.cep': 'O CEP tem 8 números.',
};
export const fieldError = (field: string) => FIELD_ERRORS[field] ?? null;

export function DeliverySheet({
  open,
  onOpenChange,
  who,
  address,
  errors,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  who: Who;
  address: Address;
  /** Core's field errors from the last try (CUSTOMER_REQUIRED, INVALID_DELIVERY) */
  errors: Record<string, string>;
  onSave: (who: Who, address: Address) => void;
}) {
  const [c, setC] = useState(who);
  const [a, setA] = useState(address);
  const [shown, setShown] = useState(!!who.digits);
  const [tried, setTried] = useState(false);
  const [fromLast, setFromLast] = useState(false);
  const filled = useRef<string | null>(null);
  const ids = {
    phone: useId(),
    name: useId(),
    street: useId(),
    number: useId(),
    complement: useId(),
    neighborhood: useId(),
    reference: useId(),
    cep: useId(),
    notes: useId(),
  };
  useEffect(() => {
    if (!open) return;
    setC(who);
    setA(address);
    setShown(!!who.digits || !!who.name || addressDone(address));
    setTried(false);
    setFromLast(false);
    filled.current = who.digits;
    // the values it opened with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const digits = useDebounced(c.digits, 350);
  useEffect(() => {
    if (c.digits) setShown(true);
  }, [c.digits]);
  const look = useQuery({
    queryKey: qk.pdvCustomer(digits ?? ''),
    queryFn: () => api.pdv.customer(digits!),
    enabled: open && !!digits && digits === c.digits,
    staleTime: 60_000,
    retry: false,
  });
  const known: PdvCustomer | null =
    digits && digits === c.digits ? (look.data?.customer ?? null) : null;

  // a returning customer: fill what's still blank with their name and last address, once
  useEffect(() => {
    if (!known || !digits || filled.current === digits) return;
    filled.current = digits;
    const last = known.lastDelivery;
    setC((x) => (x.name.trim() || !known.name ? x : { ...x, name: known.name.slice(0, 80) }));
    if (last?.street && last.neighborhood) setFromLast((v) => v || !addressDone(a));
    setA((x) =>
      addressDone(x) || !last?.street || !last.neighborhood
        ? x
        : {
            street: last.street ?? '',
            number: last.number ?? '',
            complement: last.complement ?? '',
            neighborhood: last.neighborhood ?? '',
            reference: last.reference ?? '',
            cep: maskCep(last.cep ?? ''),
            pin:
              typeof last.lat === 'number' && typeof last.lng === 'number'
                ? { lat: last.lat, lng: last.lng }
                : null,
          },
    );
  }, [known, digits]);

  // a typed change to the address drops the old pin: Core gets a fresh one
  const setAddr = (p: Partial<Address>) => {
    setFromLast(false);
    setA((x) => ({ ...x, ...p, pin: null }));
  };

  const badPhone = c.phone.trim() !== '' && !parsePhone(c.phone);
  const cep = cepDigits(a.cep);
  const local: Record<string, string | null> = {
    'customer.phone': !c.digits ? FIELD_ERRORS['customer.phone']! : null,
    'customer.name': c.name.trim().length < 2 ? FIELD_ERRORS['customer.name']! : null,
    'delivery.street': !a.street.trim() ? FIELD_ERRORS['delivery.street']! : null,
    'delivery.neighborhood': !a.neighborhood.trim() ? FIELD_ERRORS['delivery.neighborhood']! : null,
    'delivery.cep': cep.length > 0 && cep.length !== 8 ? FIELD_ERRORS['delivery.cep']! : null,
  };
  const ok = Object.values(local).every((v) => !v);
  // Core's word wins until the field changes; ours show after the first "pronto"
  const err = (f: string) =>
    errors[f] ?? (tried || (f === 'customer.phone' && badPhone) ? local[f] : null) ?? null;

  const save = () => {
    setTried(true);
    if (!ok) return;
    onSave(c, a);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Entrega"
      description="Comece pelo celular: um cliente de sempre já vem com o nome e o último endereço."
      footer={
        <Button size="lg" block onClick={save} disabled={!shown}>
          pronto
        </Button>
      }
    >
      <form
        className="space-y-5 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Celular do cliente" htmlFor={ids.phone} error={err('customer.phone')}>
          <PhoneInput
            id={ids.phone}
            autoFocus={!who.digits}
            value={c.phone}
            onChange={(v, d) => setC({ ...c, phone: v, digits: d })}
          />
          {c.digits && look.isFetching && !known ? (
            <p className="t-caption mt-1 flex items-center gap-1.5 text-muted" role="status">
              <Spinner className="size-3.5" /> procurando o cliente…
            </p>
          ) : known && known.orders > 0 ? (
            <p
              className="t-caption mt-1 inline-flex items-center gap-1.5 self-start rounded-full bg-success-soft px-2.5 py-1 font-semibold text-success"
              role="status"
            >
              <UserCircleCheck weight="fill" className="size-4" aria-hidden />
              Cliente de sempre · {known.orders} {known.orders === 1 ? 'pedido' : 'pedidos'}
            </p>
          ) : c.digits && look.isSuccess && digits === c.digits ? (
            <p className="t-caption mt-1 text-muted" role="status">
              Primeiro pedido desse celular.
            </p>
          ) : null}
        </Field>

        {shown ? (
          <>
            <Field label="Nome" htmlFor={ids.name} error={err('customer.name')}>
              <TextInput
                id={ids.name}
                maxLength={80}
                autoComplete="off"
                value={c.name}
                onChange={(e) => setC({ ...c, name: e.target.value })}
              />
            </Field>

            <fieldset className="space-y-4">
              <legend className="t-label mb-3 flex items-center gap-1.5">
                <MapPinLine weight="duotone" className="size-5" aria-hidden />
                Endereço
              </legend>
              {fromLast && addressDone(a) ? (
                <Notice tone="info" title="O último endereço desse cliente">
                  Confira com ele. Se mudou, é só editar.
                </Notice>
              ) : null}
              <Field label="Rua" htmlFor={ids.street} error={err('delivery.street')}>
                <TextInput
                  id={ids.street}
                  maxLength={120}
                  autoComplete="off"
                  value={a.street}
                  onChange={(e) => setAddr({ street: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                <Field label="Número" htmlFor={ids.number} error={err('delivery.number')}>
                  <TextInput
                    id={ids.number}
                    maxLength={10}
                    autoComplete="off"
                    value={a.number}
                    onChange={(e) => setAddr({ number: e.target.value })}
                    className="tnum"
                  />
                </Field>
                <Field
                  label="Complemento"
                  htmlFor={ids.complement}
                  optional
                  error={err('delivery.complement')}
                >
                  <TextInput
                    id={ids.complement}
                    maxLength={80}
                    autoComplete="off"
                    placeholder="apto, bloco…"
                    value={a.complement}
                    onChange={(e) => setA({ ...a, complement: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Bairro" htmlFor={ids.neighborhood} error={err('delivery.neighborhood')}>
                <TextInput
                  id={ids.neighborhood}
                  maxLength={80}
                  autoComplete="off"
                  value={a.neighborhood}
                  onChange={(e) => setAddr({ neighborhood: e.target.value })}
                />
              </Field>
              <Field
                label="Ponto de referência"
                htmlFor={ids.reference}
                optional
                error={err('delivery.reference')}
              >
                <TextInput
                  id={ids.reference}
                  maxLength={120}
                  autoComplete="off"
                  placeholder="perto da padaria, portão azul…"
                  value={a.reference}
                  onChange={(e) => setA({ ...a, reference: e.target.value })}
                />
              </Field>
              <Field label="CEP" htmlFor={ids.cep} optional error={err('delivery.cep')}>
                <TextInput
                  id={ids.cep}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="00000-000"
                  value={a.cep}
                  onChange={(e) => setAddr({ cep: maskCep(e.target.value) })}
                  className="tnum max-w-44"
                />
              </Field>
            </fieldset>

            <Field label="Observação do pedido" htmlFor={ids.notes} optional>
              <TextArea
                id={ids.notes}
                maxLength={500}
                value={c.notes}
                className="min-h-20"
                onChange={(e) => setC({ ...c, notes: e.target.value })}
              />
            </Field>
          </>
        ) : null}
      </form>
    </Sheet>
  );
}
