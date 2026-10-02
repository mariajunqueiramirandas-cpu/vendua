import {
  ArrowSquareOut,
  CreditCard,
  Crosshair,
  ForkKnife,
  LockSimple,
  MapPin,
  Money,
  PixLogo,
  Path,
  Signpost,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_TOKENS, paletteFrom, readableAccent } from '@vendua/templates';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api, type Payments, type PayMethod, type StoreTokens } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { messageOf } from '../../ui/feedback.tsx';
import { Chips, Field, MoneyField, TextInput, Toggle } from '../../ui/fields.tsx';
import { toast } from '../../ui/Toast.tsx';
import { logoColors, PRESETS, readable } from '../appearance/Colors.tsx';
import { Choice, deliveryReady, Frame, type StepProps } from './steps.tsx';

const ZoneMap = lazy(() => import('../../ui/ZoneMap.tsx').then((m) => ({ default: m.ZoneMap })));

function useBusy() {
  const [busy, setBusy] = useState(false);
  return [busy, (p: Promise<unknown>) => (setBusy(true), p.finally(() => setBusy(false)))] as const;
}

// ── cores ───────────────────────────────────────────────────────────────────

/** Swatches only (logo colours first): the full editor stays in Aparência. */
export function ColorsStep({
  draft,
  patch,
  next,
  back,
  skip,
  eyebrow,
  tokens,
  onSaved,
}: StepProps & { tokens: StoreTokens | null; onSaved: (t: StoreTokens) => void }) {
  const [fromLogo, setFromLogo] = useState<string[]>([]);
  useEffect(() => {
    if (!draft.logoUrl) return;
    logoColors(draft.logoUrl).then(setFromLogo, () => setFromLogo([]));
  }, [draft.logoUrl]);
  const base = tokens ?? DEFAULT_TOKENS;
  const [picked, setPicked] = useState<StoreTokens | null>(null);
  const save = useMutation({
    mutationFn: (t: StoreTokens) => api.saveTokens(t),
    onSuccess: (_r, t) => {
      onSaved(t);
      next('Que combinação!');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const swatches = [...fromLogo.map((c) => [c, 'do logo'] as [string, string]), ...PRESETS].slice(
    0,
    8,
  );
  const current = (picked ?? tokens)?.color.accent ?? null;
  return (
    <Frame
      eyebrow={eyebrow}
      title="Escolha a cor da loja"
      hint={
        fromLogo.length
          ? 'As primeiras cores saíram do seu logo. Ela vai nos botões e nos detalhes.'
          : 'Ela vai nos botões e nos detalhes. Dá para mudar quando quiser, em Aparência.'
      }
      back={back}
      busy={save.isPending}
      disabled={!picked && !tokens}
      onSkip={picked || tokens ? undefined : skip}
      onSubmit={() => (picked ? save.mutate(picked) : next())}
    >
      <div role="radiogroup" aria-label="cores" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {swatches.map(([c, name], i) => {
          const accent = readableAccent(c);
          const on = current === accent;
          return (
            <button
              key={c + i}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`cor ${name}`}
              onClick={() => {
                const t = paletteFrom(c, base);
                if (!readable(t)) return toast.error('Essa cor fica difícil de ler. Tente outra.');
                setPicked(t);
                patch({ accent: t.color.accent, onAccent: t.color.onAccent });
              }}
              className={cn(
                'press flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg bg-surface p-3 transition-[box-shadow]',
                on ? 'ring-2 ring-primary' : 'ring-1 ring-line-strong hover:bg-hover',
              )}
            >
              <span
                className="size-10 rounded-full ring-2 ring-surface depth-1"
                style={{ background: accent }}
              />
              <span className="t-caption font-semibold">{name}</span>
            </button>
          );
        })}
      </div>
    </Frame>
  );
}

// ── entrega ─────────────────────────────────────────────────────────────────

const FEE_MAX = 100_000;
const feeRule = (c: number) => (c > FEE_MAX ? `Até ${money(FEE_MAX)}.` : null);

/** How delivery is priced: a fee per bairro list, or by road distance from the store's pin (ADR 0024). */
export function DeliveryStep({ s, draft, save, next, back, skip, eyebrow }: StepProps) {
  const qc = useQueryClient();
  const [busy, run] = useBusy();
  const zoneMade = useRef(false);
  const ready = deliveryReady(s);
  const [mode, setMode] = useState<'bairro' | 'km'>(s.distancePricing.enabled ? 'km' : 'bairro');
  // bairros
  const [places, setPlaces] = useState('');
  const [fee, setFee] = useState<number | null>(null);
  const list = places
    .split(/[,\n;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  // distância
  const [line, setLine] = useState(
    [s.operations.pickupAddress ?? s.profile.address, s.profile.city].filter(Boolean).join(', '),
  );
  const [pin, setPin] = useState(s.location);
  const [finding, setFinding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [base, setBase] = useState<number | null>(
    s.distancePricing.enabled ? s.distancePricing.baseFeeCents : null,
  );
  const [perKm, setPerKm] = useState<number | null>(
    s.distancePricing.enabled ? s.distancePricing.feePerKmCents : null,
  );
  const [maxKm, setMaxKm] = useState(String(s.distancePricing.maxKm || 8));
  const km = Number(maxKm.replace(',', '.'));
  const kmOk = Number.isFinite(km) && km >= 1 && km <= 50;

  const find = async () => {
    setFinding(true);
    try {
      const { point } = await api.geocode(line);
      if (!point) return void toast.error('Não achei no mapa. Toque no mapa para marcar à mão.');
      setPin({ latitude: point.lat, longitude: point.lng });
      toast(
        point.precision === 'address'
          ? 'Achei! Confira o pino no mapa.'
          : 'Marquei perto. Toque em “ajustar” e depois no lugar certo.',
      );
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setFinding(false);
    }
  };

  const on = { pickupEnabled: draft.pickup, deliveryEnabled: true };
  const ok = ready
    ? true
    : mode === 'bairro'
      ? list.length > 0 && fee !== null
      : !!pin && base !== null && perKm !== null && kmOk;

  return (
    <Frame
      eyebrow={eyebrow}
      title="Quanto custa a entrega?"
      hint={
        ready
          ? 'Sua entrega já tem preço. Dá para ajustar em Loja, quando quiser.'
          : 'Escolha o jeito mais fácil para você. O site calcula sozinho para cada cliente.'
      }
      back={back}
      busy={busy}
      disabled={!ok}
      onSkip={ready ? undefined : skip}
      skipLabel="faço depois"
      onSubmit={() =>
        void run(
          (async () => {
            if (ready) {
              if (!s.operations.deliveryEnabled && !(await save({ operations: on }))) return;
              return next();
            }
            if (mode === 'bairro') {
              // the zone first: if it fails, delivery stays off rather than on with nowhere to go;
              // a second tap after a failed switch-on doesn't make the zone twice
              if (!zoneMade.current) {
                try {
                  await api.createZone({
                    name: 'Entrega',
                    kind: 'neighborhood',
                    neighborhoods: list,
                    feeCents: fee ?? 0,
                  });
                  zoneMade.current = true;
                  void qc.invalidateQueries({ queryKey: qk.store });
                } catch (e) {
                  return void toast.error(messageOf(e));
                }
              }
              if (await save({ operations: on })) next('Entrega combinada!');
              return;
            }
            // the pin before the rule: Core refuses distance pricing without one
            if (!(await save({ location: pin }))) return;
            if (
              await save({
                distancePricing: {
                  enabled: true,
                  baseFeeCents: base ?? 0,
                  feePerKmCents: perKm ?? 0,
                  maxKm: km,
                },
                operations: on,
              })
            )
              next('Entrega pelo caminho, que moderno!');
          })(),
        )
      }
    >
      {ready ? null : (
        <>
          <div className="space-y-3">
            <Choice
              role="radio"
              on={mode === 'bairro'}
              onClick={() => setMode('bairro')}
              icon={<Signpost />}
              title="Por bairro"
              body="Você diz os bairros e uma taxa. Simples."
            />
            <Choice
              role="radio"
              on={mode === 'km'}
              onClick={() => setMode('km')}
              icon={<Path />}
              title="Por distância"
              body="Uma taxa de saída mais um valor por km, pelo caminho de carro."
            />
          </div>
          {mode === 'bairro' ? (
            <Card className="animate-fade-up space-y-4 p-4">
              <Field
                label="Em quais bairros você entrega?"
                htmlFor="ob-places"
                helper="Separe com vírgula. Depois dá para separar por área, com taxas diferentes."
              >
                <TextInput
                  id="ob-places"
                  maxLength={400}
                  value={places}
                  onChange={(e) => setPlaces(e.target.value)}
                  placeholder="Ex.: Centro, Itaúna, Vilatur"
                />
              </Field>
              <Field
                label="Quanto cobra pela entrega?"
                htmlFor="ob-fee"
                helper="Se for de graça, digite 0."
              >
                <MoneyField id="ob-fee" cents={fee} validate={feeRule} onCommit={setFee} />
              </Field>
            </Card>
          ) : (
            <Card className="animate-fade-up space-y-4 p-4">
              <Field
                label="De onde sai a entrega?"
                htmlFor="ob-from"
                helper="O endereço da cozinha. Ele não aparece para os clientes."
              >
                <div className="flex gap-2">
                  <TextInput
                    id="ob-from"
                    maxLength={300}
                    autoComplete="street-address"
                    value={line}
                    onChange={(e) => setLine(e.target.value)}
                    placeholder="Rua, número, bairro e cidade"
                  />
                  <Button
                    variant="secondary"
                    icon={<MapPin />}
                    loading={finding}
                    disabled={line.trim().length < 5}
                    onClick={() => void find()}
                  >
                    achar
                  </Button>
                </div>
              </Field>
              {/* isolate: Leaflet's panes (z-index 400) stay under the sticky buttons */}
              <div className="isolate overflow-hidden rounded-md ring-1 ring-line">
                <div className="flex items-center justify-between gap-2 bg-sunken px-3 py-2">
                  <p className="t-caption text-muted">
                    {moving
                      ? 'Toque no mapa onde fica a loja.'
                      : pin
                        ? 'O pino é de onde a entrega sai.'
                        : 'Ache pelo endereço ou marque no mapa.'}
                  </p>
                  <Button
                    variant={moving ? 'primary' : 'ghost'}
                    size="sm"
                    icon={<Crosshair />}
                    onClick={() => setMoving((v) => !v)}
                  >
                    {moving ? 'toque no mapa' : pin ? 'ajustar' : 'marcar'}
                  </Button>
                </div>
                <Suspense fallback={<div className="skeleton h-56" />}>
                  <ZoneMap
                    center={pin}
                    zones={[]}
                    className="h-56 w-full"
                    label="local da loja"
                    onPick={
                      moving
                        ? (p) => {
                            setMoving(false);
                            setPin(p);
                          }
                        : undefined
                    }
                  />
                </Suspense>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Taxa de saída" htmlFor="ob-base">
                  <MoneyField id="ob-base" cents={base} validate={feeRule} onCommit={setBase} />
                </Field>
                <Field label="Por km" htmlFor="ob-km">
                  <MoneyField id="ob-km" cents={perKm} validate={feeRule} onCommit={setPerKm} />
                </Field>
                <Field label="Entrega até" htmlFor="ob-max" error={kmOk ? null : 'De 1 a 50 km.'}>
                  <TextInput
                    id="ob-max"
                    inputMode="decimal"
                    maxLength={4}
                    value={maxKm}
                    trail="km"
                    onChange={(e) => setMaxKm(e.target.value.replace(/[^\d,.]/g, ''))}
                  />
                </Field>
              </div>
              {base !== null && perKm !== null && kmOk ? (
                <p className="t-body rounded-md bg-sunken px-3 py-2" role="status">
                  {money(base)} de saída, mais {money(perKm)} por km, até{' '}
                  {km.toLocaleString('pt-BR')} km. Cada km começado conta inteiro.
                </p>
              ) : null}
            </Card>
          )}
        </>
      )}
    </Frame>
  );
}

// ── Pagamentos ──────────────────────────────────────────────────────────────

const OFFLINE: { id: PayMethod; label: string; body: string; Icon: typeof Money }[] = [
  { id: 'pix', label: 'Pix', body: 'Na sua chave, sem taxa nossa.', Icon: PixLogo },
  {
    id: 'card_on_delivery',
    label: 'Cartão na entrega',
    body: 'Na maquininha, na entrega ou retirada.',
    Icon: CreditCard,
  },
  { id: 'cash', label: 'Dinheiro', body: 'Na entrega ou retirada, com troco.', Icon: Money },
  {
    id: 'meal_voucher',
    label: 'Vale-refeição',
    body: 'O cartão de vale na maquininha.',
    Icon: ForkKnife,
  },
];

export function MethodsStep({ pay, next, back, eyebrow }: StepProps & { pay: Payments }) {
  const qc = useQueryClient();
  const [methods, setMethods] = useState<PayMethod[]>(pay.methods);
  const save = useMutation({
    mutationFn: () => api.updatePayments({ methods }),
    onSuccess: (d) => {
      qc.setQueryData(qk.payments, d);
      next('Combinado!');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const changed =
    methods.length !== pay.methods.length || methods.some((m) => !pay.methods.includes(m));
  return (
    <Frame
      eyebrow={eyebrow}
      title="Como o cliente pode pagar?"
      hint="Marque o que você aceita. O site só mostra essas opções."
      back={back}
      busy={save.isPending}
      disabled={!methods.length}
      onSubmit={() => (changed ? save.mutate() : next('Combinado!'))}
    >
      <Card className="divide-y divide-line px-4">
        {OFFLINE.map((m) => {
          const on = methods.includes(m.id);
          return (
            <div key={m.id} className="flex items-center gap-3 py-2">
              <m.Icon weight="duotone" className="size-7 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <Toggle
                  checked={on}
                  disabled={on && methods.length === 1}
                  onChange={(v) =>
                    setMethods((x) => (v ? [...x, m.id] : x.filter((y) => y !== m.id)))
                  }
                  label={m.label}
                  description={m.body}
                />
              </div>
            </div>
          );
        })}
      </Card>
      {pay.mercadoPago.available && pay.mercadoPago.status !== 'connected' ? (
        <p className="t-caption text-muted">Cartão pelo site vem a seguir, com o Mercado Pago.</p>
      ) : null}
    </Frame>
  );
}

const KEY_TYPES = [
  { value: 'phone', label: 'celular' },
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'e-mail' },
  { value: 'random', label: 'aleatória' },
] as const;

export function PixStep({ pay, next, back, skip, eyebrow, me, s }: StepProps & { pay: Payments }) {
  const qc = useQueryClient();
  // the owner's verified number is the commonest Pix key; their name is the beneficiary
  const [type, setType] = useState<string>('phone');
  const [key, setKey] = useState(me.phone ? me.phone.replace(/^55/, '') : '');
  const [name, setName] = useState(me.name.slice(0, 25));
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api.updatePayments({
        pix: {
          keyType: type,
          key: key.trim(),
          beneficiary: name.trim(),
          city: s.profile.city?.slice(0, 15) || null,
        },
      }),
    onSuccess: (d) => {
      qc.setQueryData(qk.payments, d);
      void qc.invalidateQueries({ queryKey: qk.home });
      next('Pix pronto, o dinheiro cai direto na sua conta.');
    },
    onError: (e) => setErr(messageOf(e)),
  });
  const noPix = !pay.methods.includes('pix');
  if (pay.pix || noPix)
    return (
      <Frame
        eyebrow={eyebrow}
        title={noPix ? 'Sem Pix por enquanto' : 'Seu Pix já está pronto'}
        hint={
          noPix
            ? 'Você deixou o Pix de fora. Quando quiser aceitar, é em Pagamentos.'
            : `A chave ${pay.pix!.key} recebe os pedidos. O cliente vê o Pix com o valor já preenchido.`
        }
        back={back}
        onSubmit={() => next()}
      />
    );
  return (
    <Frame
      eyebrow={eyebrow}
      title="Qual é a sua chave Pix?"
      hint="O cliente paga e o dinheiro cai direto na sua conta, sem taxa nossa."
      back={back}
      busy={m.isPending}
      disabled={!key.trim() || name.trim().length < 2}
      label="Salvar Pix"
      onSkip={skip}
      skipLabel="faço depois"
      onSubmit={() => {
        setErr(null);
        m.mutate();
      }}
    >
      <Chips
        label="tipo de chave"
        value={type}
        onChange={(t) => {
          setType(t);
          setErr(null);
          if (t !== 'phone' && key === me.phone.replace(/^55/, '')) setKey('');
        }}
        options={KEY_TYPES.map((k) => ({ ...k }))}
      />
      <Field label="Chave Pix" htmlFor="ob-pix" error={err}>
        <TextInput
          id="ob-pix"
          value={key}
          maxLength={100}
          inputMode={type === 'email' ? 'email' : type === 'random' ? 'text' : 'numeric'}
          autoComplete="off"
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      <Field label="Nome de quem recebe" htmlFor="ob-pixname" helper="Como aparece no seu banco.">
        <TextInput
          id="ob-pixname"
          maxLength={25}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
    </Frame>
  );
}

export function MercadoPagoStep({ back, skip, eyebrow }: StepProps) {
  const go = useMutation({
    mutationFn: () => api.mpConnect('onboarding'),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Frame
      eyebrow={eyebrow}
      title="Receber cartão pelo site"
      hint="Conectando a sua conta do Mercado Pago, o cliente paga com cartão ou Pix no site e o pedido já chega pago."
      back={back}
      busy={go.isPending}
      label="Conectar o Mercado Pago"
      onSkip={() => skip()}
      skipLabel="agora não"
      onSubmit={() => go.mutate()}
    >
      <Card className="space-y-3 p-5">
        <ul className="t-body space-y-2">
          <li className="flex items-start gap-2">
            <CreditCard weight="duotone" className="mt-0.5 size-5 shrink-0" /> Crédito e débito no
            site, sem maquininha.
          </li>
          <li className="flex items-start gap-2">
            <PixLogo weight="duotone" className="mt-0.5 size-5 shrink-0" /> Pix confirmado sozinho:
            nada de conferir no banco.
          </li>
          <li className="flex items-start gap-2">
            <ArrowSquareOut weight="duotone" className="mt-0.5 size-5 shrink-0" /> Você entra no
            Mercado Pago, autoriza e volta para cá.
          </li>
        </ul>
        <p className="t-caption flex items-center gap-2 text-muted">
          <LockSimple className="size-4 shrink-0" aria-hidden /> O Mercado Pago cobra a tarifa dele
          nos pagamentos online. A Venduá não cobra nada por pedido.
        </p>
      </Card>
    </Frame>
  );
}
