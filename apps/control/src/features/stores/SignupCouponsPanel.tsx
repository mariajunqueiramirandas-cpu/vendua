import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Copy, Plus, TicketPercent } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, type NewSignupCoupon, type SignupCoupon } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDate, fmtMoney, parseMoney } from '@/lib/format.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { errorMessage } from '@/lib/query.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EditableText } from '@/components/EditableText.tsx';
import { EmptyState, ErrorState, Fact } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Checkbox, Segmented, Switch } from '@/components/ui/controls.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import {
  useControlPlans,
  useCreateSignupCoupons,
  usePatchSignupCoupon,
  useSignupCoupons,
} from './queries.ts';

// "cupons de cadastro" (ADR 0042): what a new owner types on signup's last step — free days and/or
// a discount on the first paid months. Core fixes a coupon's terms once made; here staff make
// them, hand them out, switch them off and see who used them.

/** an expiry is the end of a São Paulo day: shown on that day wherever staff are */
const untilDay = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });

const uses = (c: SignupCoupon) =>
  c.maxUses === null
    ? `${c.uses} usos`
    : `${c.uses}/${c.maxUses} ${c.maxUses === 1 ? 'uso' : 'usos'}`;

/** what the CRM shows as the coupon's state, most final first */
function state(c: SignupCoupon): { label: string; tone: 'ok' | 'off' } {
  if (!c.active) return { label: 'desligado', tone: 'off' };
  if (c.expiresAt && new Date(c.expiresAt).getTime() <= Date.now())
    return { label: 'vencido', tone: 'off' };
  if (c.maxUses !== null && c.uses >= c.maxUses) return { label: 'esgotado', tone: 'off' };
  return { label: 'ativo', tone: 'ok' };
}

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copiado`),
    () => toast.error('não deu para copiar'),
  );
}

/** the code opens the coupon; the copy button beside it copies (siblings: no button in a button) */
function CodeCell({ c, onOpen }: { c: SignupCoupon; onOpen?: (() => void) | undefined }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {onOpen ? (
        <button
          type="button"
          className="truncate font-mono text-[13px] font-medium tracking-wide underline-offset-2 hover:underline"
          title="ver detalhes"
          onClick={onOpen}
        >
          {c.code}
        </button>
      ) : (
        <span className="truncate font-mono text-[13px] font-medium tracking-wide">{c.code}</span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`copiar ${c.code}`}
        onClick={(e) => {
          e.stopPropagation();
          copy(c.code, 'código');
        }}
      >
        <Copy />
      </Button>
    </span>
  );
}

export function SignupCouponsPanel() {
  const query = useSignupCoupons();
  const plans = useControlPlans();
  const patch = usePatchSignupCoupon();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const coupons = query.data ?? [];
  const open = coupons.find((c) => c.id === sp.get('cupom')) ?? null;
  const creating = sp.get('cupom') === 'novo';
  const setOpen = (id: string | null) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (id) n.set('cupom', id);
        else n.delete('cupom');
        return n;
      },
      { replace: !id },
    );
  const planName = (id: string) => plans.data?.find((p) => p.id === id)?.name ?? id;
  const plansLabel = (c: SignupCoupon) =>
    c.planIds ? c.planIds.map(planName).join(', ') : 'todos os planos';

  const active = (c: SignupCoupon) => (
    <Switch
      checked={c.active}
      aria-label={`cupom ${c.code} ligado`}
      disabled={patch.isPending}
      onCheckedChange={(v) => patch.mutate({ id: c.id, active: v })}
    />
  );

  const columns: Column<SignupCoupon>[] = [
    {
      key: 'code',
      header: 'código',
      className: 'max-w-[15rem]',
      cell: (c) => (
        <div className="min-w-0">
          <CodeCell c={c} onOpen={() => setOpen(c.id)} />
          {c.note && <span className="block truncate text-xs text-muted-foreground">{c.note}</span>}
        </div>
      ),
    },
    { key: 'gives', header: 'o que dá', className: 'w-full', cell: (c) => c.label },
    {
      key: 'plans',
      header: 'planos',
      className: 'whitespace-nowrap text-muted-foreground',
      cell: plansLabel,
    },
    { key: 'uses', header: 'usos', className: 'whitespace-nowrap tnum', cell: uses },
    {
      key: 'until',
      header: 'validade',
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (c) => (c.expiresAt ? `até ${untilDay(c.expiresAt)}` : 'sem validade'),
    },
    {
      key: 'active',
      header: 'ligado',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (c) => {
        const s = state(c);
        return (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{s.label}</span>
            {active(c)}
          </span>
        );
      },
    },
  ];

  const mobileRow = (c: SignupCoupon) => {
    const s = state(c);
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-mono text-sm font-medium tracking-wide">{c.code}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tnum">{uses(c)}</span>
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {c.label} · {s.label}
        </span>
      </div>
    );
  };

  return (
    <Panel
      flush
      title="cupons de cadastro"
      aside={mobile ? undefined : 'o dono digita no fim do cadastro · dias grátis ou desconto'}
      actions={
        <Button size="sm" variant="outline" onClick={() => setOpen('novo')}>
          <Plus />
          novo cupom
        </Button>
      }
      className="overflow-hidden"
    >
      {query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <DataList
          rows={coupons}
          rowKey={(c) => c.id}
          columns={columns}
          mobileRow={mobileRow}
          rowClassName={(c) => (state(c).tone === 'off' ? 'opacity-55' : undefined)}
          {...(mobile ? { onRowClick: (c: SignupCoupon) => setOpen(c.id) } : {})}
          loading={query.isPending}
          empty={
            <EmptyState
              icon={TicketPercent}
              title="nenhum cupom ainda"
              hint="crie um código para dar dias grátis ou desconto a quem se cadastrar"
            />
          }
        />
      )}

      <ResponsiveSheet
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open?.code ?? 'cupom'}
        description={open?.label}
      >
        {open && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <Fact label="estado">{state(open).label}</Fact>
              {active(open)}
            </div>
            <Fact label="nota">
              <EditableText
                value={open.note ?? ''}
                label={`nota do cupom ${open.code}`}
                placeholder="para quem é, onde foi divulgado"
                onSave={(v) => patch.mutate({ id: open.id, note: v?.trim() || null })}
              />
            </Fact>
            <div className="grid grid-cols-2 gap-3">
              <Fact label="planos">{plansLabel(open)}</Fact>
              <Fact label="usos">{uses(open)}</Fact>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Fact label="validade">
                {open.expiresAt ? `até ${untilDay(open.expiresAt)}` : 'sem validade'}
              </Fact>
              <Fact label="criado">{fmtDate(open.createdAt)}</Fact>
            </div>
            <Button variant="outline" size="sm" onClick={() => copy(open.code, 'código')}>
              <Copy />
              copiar o código
            </Button>
            <div className="flex flex-col gap-1.5 pt-1">
              <span className="text-xs font-medium text-foreground/80">lojas que usaram</span>
              {open.stores.length ? (
                <ul className="flex flex-col gap-1">
                  {open.stores.map((s) => (
                    <li key={s.id} className="flex min-w-0 items-baseline gap-2 text-sm">
                      <Link
                        to={`/lojas/${s.id}`}
                        className="truncate underline-offset-2 hover:underline"
                      >
                        {s.name}
                      </Link>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {fmtDate(s.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">ninguém usou ainda</p>
              )}
              {open.uses > open.stores.length && (
                <p className="text-xs text-muted-foreground">mostrando as 5 mais recentes</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              o que o cupom dá não muda depois de criado: para outras condições, crie outro e
              desligue este
            </p>
          </div>
        )}
      </ResponsiveSheet>

      <NewCouponSheet open={creating} onClose={() => setOpen(null)} />
    </Panel>
  );
}

type Mode = 'one' | 'batch';

/** fields whose error shows under the field itself; anything else shows at the bottom */
const FORM_FIELDS = new Set([
  'code',
  'maxUses',
  'quantity',
  'prefix',
  'freeDays',
  'discount.value',
  'discount.months',
  'expiresAt',
]);
type DiscountKind = 'none' | 'percent' | 'amount';

/** whole number in [min, max], or null for empty/out of range */
const int = (v: string, min: number, max: number) => {
  if (!/^\d+$/.test(v.trim())) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
};

function NewCouponSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateSignupCoupons();
  const plans = useControlPlans();
  const mobile = useIsMobile();
  const [mode, setMode] = useState<Mode>('one');
  const [code, setCode] = useState('');
  const [quantity, setQuantity] = useState('10');
  const [prefix, setPrefix] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [freeDays, setFreeDays] = useState('');
  const [kind, setKind] = useState<DiscountKind>('none');
  const [value, setValue] = useState('');
  const [months, setMonths] = useState('1');
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<{ field: string | null; text: string } | null>(null);
  const [made, setMade] = useState<SignupCoupon[] | null>(null);

  const reset = () => {
    setMode('one');
    setCode('');
    setQuantity('10');
    setPrefix('');
    setMaxUses('1');
    setFreeDays('');
    setKind('none');
    setValue('');
    setMonths('1');
    setPlanIds([]);
    setUntil('');
    setNote('');
    setErr(null);
    setMade(null);
  };
  const close = () => {
    onClose();
    reset();
  };

  const offered = (plans.data ?? []).filter((p) => p.public);
  const days = freeDays.trim() ? int(freeDays, 0, 365) : 0;
  const discountValue =
    kind === 'percent' ? int(value, 1, 99) : kind === 'amount' ? parseMoney(value) : null;
  const discountMonths = int(months, 1, 24);

  const fieldErr = (f: string) => (err?.field === f ? err.text : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (days === null) return setErr({ field: 'freeDays', text: 'dias grátis vai de 0 a 365' });
    if (kind !== 'none' && (discountValue === null || discountValue <= 0))
      return setErr({
        field: 'discount.value',
        text: kind === 'percent' ? 'o desconto vai de 1% a 99%' : 'digite o valor do desconto',
      });
    if (kind !== 'none' && discountMonths === null)
      return setErr({ field: 'discount.months', text: 'de 1 a 24 meses' });
    if (!days && kind === 'none')
      return setErr({
        field: 'freeDays',
        text: 'o cupom precisa dar dias grátis, desconto ou os dois',
      });
    const body: NewSignupCoupon = {
      ...(days ? { freeDays: days } : {}),
      ...(kind !== 'none'
        ? { discount: { kind, value: discountValue!, months: discountMonths! } }
        : {}),
      ...(planIds.length ? { planIds } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      // the end of that day, São Paulo time
      ...(until ? { expiresAt: new Date(`${until}T23:59:59-03:00`).toISOString() } : {}),
    };
    if (mode === 'batch') {
      const n = int(quantity, 1, 200);
      if (n === null) return setErr({ field: 'quantity', text: 'de 1 a 200 códigos' });
      Object.assign(body, {
        quantity: n,
        maxUses: 1,
        ...(prefix.trim() ? { prefix: prefix.trim() } : {}),
      });
    } else {
      if (code.trim()) body.code = code.trim();
      if (maxUses.trim()) {
        const m = int(maxUses, 1, 100_000);
        if (m === null) return setErr({ field: 'maxUses', text: 'de 1 a 100.000, ou vazio' });
        body.maxUses = m;
      } else body.maxUses = null;
    }
    create.mutate(body, {
      onSuccess: (r) => {
        toast.success(
          r.coupons.length === 1 ? 'cupom criado' : `${r.coupons.length} cupons criados`,
        );
        setMade(r.coupons);
      },
      onError: (e) =>
        setErr({
          field: e instanceof ApiError ? ((e.details?.field as string | undefined) ?? null) : null,
          text:
            e instanceof ApiError && e.code === 'COUPON_CODE_TAKEN'
              ? 'esse código já existe'
              : errorMessage(e),
        }),
    });
  };

  const codes = made?.map((c) => c.code).join('\n') ?? '';

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => !o && close()}
      title={
        made ? (made.length === 1 ? 'cupom criado' : `${made.length} cupons criados`) : 'novo cupom'
      }
      description={made ? made[0]!.label : 'para quem vai se cadastrar na Venduá'}
      footer={
        made ? (
          <>
            <Button variant="outline" onClick={reset}>
              criar outro
            </Button>
            <Button onClick={() => copy(codes, made.length === 1 ? 'código' : 'códigos')}>
              <Copy />
              {made.length === 1 ? 'copiar o código' : 'copiar todos'}
            </Button>
          </>
        ) : (
          <>
            {!mobile && (
              <Button variant="ghost" onClick={close}>
                cancelar
              </Button>
            )}
            <Button type="submit" form="new-coupon" disabled={create.isPending}>
              {create.isPending ? 'criando…' : 'criar'}
            </Button>
          </>
        )
      }
    >
      {made ? (
        <div className="flex flex-col gap-3">
          <ul
            className={cn(
              'flex flex-col divide-y rounded-md border bg-card font-mono text-sm',
              made.length > 8 && 'max-h-80 overflow-auto',
            )}
          >
            {made.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="truncate tracking-wide">{c.code}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`copiar ${c.code}`}
                  onClick={() => copy(c.code, 'código')}
                >
                  <Copy />
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {made.length > 1
              ? 'cada código vale uma vez: mande um para cada pessoa'
              : made[0]!.maxUses === 1
                ? 'vale uma vez'
                : made[0]!.maxUses === null
                  ? 'vale para quantas lojas usarem, uma vez por WhatsApp'
                  : `vale ${made[0]!.maxUses} vezes, uma por WhatsApp`}
            {' · o dono digita em “tenho um cupom”, no fim do cadastro'}
          </p>
        </div>
      ) : (
        <form id="new-coupon" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Segmented
            label="quantos códigos"
            value={mode}
            onChange={setMode}
            options={[
              ['one', 'um código'],
              ['batch', 'vários de uso único'],
            ]}
            className="self-start"
          />

          {mode === 'one' ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Field
                label="código"
                htmlFor="nc-code"
                hint={fieldErr('code') ?? 'vazio: a Venduá gera um'}
              >
                <Input
                  id="nc-code"
                  value={code}
                  maxLength={40}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="FEIRA2026"
                  className="font-mono uppercase"
                  aria-invalid={!!fieldErr('code')}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                />
              </Field>
              <Field
                label="usos"
                htmlFor="nc-max"
                hint={fieldErr('maxUses') ?? 'vazio: sem limite'}
              >
                <Input
                  id="nc-max"
                  inputMode="numeric"
                  value={maxUses}
                  placeholder="∞"
                  aria-invalid={!!fieldErr('maxUses')}
                  onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-[6rem_1fr] gap-3">
              <Field label="quantos" htmlFor="nc-qty" hint={fieldErr('quantity')}>
                <Input
                  id="nc-qty"
                  inputMode="numeric"
                  value={quantity}
                  aria-invalid={!!fieldErr('quantity')}
                  onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <Field
                label="começo do código"
                htmlFor="nc-prefix"
                hint={fieldErr('prefix') ?? `ex.: ${prefix.trim() || 'FEIRA'}-7KQ2-XM9P`}
              >
                <Input
                  id="nc-prefix"
                  value={prefix}
                  maxLength={12}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="opcional"
                  className="font-mono uppercase"
                  onChange={(e) =>
                    setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                />
              </Field>
            </div>
          )}

          <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium text-foreground/80">o que dá</legend>
            <Field
              label="dias grátis"
              htmlFor="nc-days"
              hint={
                fieldErr('freeDays') ??
                'a loja abre na hora, sem cartão, em qualquer plano — mesmo se o WhatsApp já usou o teste grátis'
              }
            >
              <Input
                id="nc-days"
                inputMode="numeric"
                value={freeDays}
                placeholder="0"
                className="max-w-28"
                aria-invalid={!!fieldErr('freeDays')}
                onChange={(e) => setFreeDays(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground/80">
                desconto nos primeiros meses pagos
              </span>
              <Segmented
                label="tipo de desconto"
                size="sm"
                value={kind}
                onChange={(k) => {
                  setKind(k);
                  setValue('');
                }}
                options={[
                  ['none', 'sem desconto'],
                  ['percent', '%'],
                  ['amount', 'R$'],
                ]}
                className="self-start"
              />
            </div>
            {kind !== 'none' && (
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={kind === 'percent' ? 'desconto (%)' : 'desconto por mês'}
                  htmlFor="nc-value"
                  hint={fieldErr('discount.value')}
                >
                  <Input
                    id="nc-value"
                    inputMode={kind === 'percent' ? 'numeric' : 'decimal'}
                    value={value}
                    placeholder={kind === 'percent' ? '50' : '20,00'}
                    aria-invalid={!!fieldErr('discount.value')}
                    onChange={(e) =>
                      setValue(
                        kind === 'percent' ? e.target.value.replace(/\D/g, '') : e.target.value,
                      )
                    }
                  />
                </Field>
                <Field
                  label="por quantos meses"
                  htmlFor="nc-months"
                  hint={fieldErr('discount.months')}
                >
                  <Input
                    id="nc-months"
                    inputMode="numeric"
                    value={months}
                    aria-invalid={!!fieldErr('discount.months')}
                    onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
              </div>
            )}
            {kind !== 'none' && (
              <p className="text-xs text-muted-foreground">
                {kind === 'amount' && discountValue
                  ? `${fmtMoney(discountValue)} a menos em cada mês com desconto. `
                  : ''}
                nenhum mês sai por menos de {fmtMoney(100)}: para meses sem cobrança, use dias
                grátis.
              </p>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-medium text-foreground/80">planos</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {offered.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={planIds.includes(p.id)}
                    onCheckedChange={(v) =>
                      setPlanIds((ids) => (v ? [...ids, p.id] : ids.filter((id) => id !== p.id)))
                    }
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {planIds.length ? 'só nos planos marcados' : 'nenhum marcado: vale em todos'}
            </p>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="vale até"
              htmlFor="nc-until"
              hint={fieldErr('expiresAt') ?? 'vazio: sem validade'}
            >
              <Input
                id="nc-until"
                type="date"
                value={until}
                min={new Date().toISOString().slice(0, 10)}
                aria-invalid={!!fieldErr('expiresAt')}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
            <Field label="nota" htmlFor="nc-note" hint="só a equipe vê">
              <Input
                id="nc-note"
                value={note}
                maxLength={200}
                placeholder="parceiros da feira"
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>

          {err && !FORM_FIELDS.has(err.field ?? '') && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {err.text}
            </p>
          )}
        </form>
      )}
    </ResponsiveSheet>
  );
}
