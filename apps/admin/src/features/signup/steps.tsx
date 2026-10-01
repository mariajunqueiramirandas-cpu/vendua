import {
  CheckCircle,
  CreditCard,
  Globe,
  Key,
  PixLogo,
  Storefront,
  WarningCircle,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Plan, type Session, type StoreRef } from '../../lib/api.ts';
import { money, phone as fmtPhone } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { resetClient } from '../../lib/persist.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { ROLE_LABEL } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { CodeInput, type CodeInputHandle } from '../../ui/CodeInput.tsx';
import { DuaNote, messageOf, Skeleton } from '../../ui/feedback.tsx';
import { Field, PhoneInput, TextInput } from '../../ui/fields.tsx';
import { perMonth, PlanOption } from '../../ui/PlanCard.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { StepFrame } from '../../ui/StepFrame.tsx';
import { EMAIL_RE, expiry, savePending } from '../auth/pending.ts';
import { saveToken, slugify, type Draft, type StepId, type Verified } from './progress.ts';

export type PlansData = Awaited<ReturnType<typeof api.signup.plans>>;

export interface FlowProps {
  d: Draft;
  patch: (p: Partial<Draft>) => void;
  go: (step: StepId, say?: { praise?: string | null; notice?: string | null }) => void;
  /** a note carried into the next step ("o código venceu") */
  notice: string | null;
  plans: PlansData;
}

export const addressOf = (slug: string, domain: string) => `${slug || 'sualoja'}.${domain}`;

// ── 1 · plano ────────────────────────────────────────────────────────────

export function PlanStep({ d, patch, go, plans, notice }: FlowProps) {
  const open = plans.billing.available || plans.billing.accessCode;
  return (
    <StepFrame
      title="Escolha o seu plano"
      hint="Dá para trocar depois, quando quiser. Você paga por mês, com Pix ou cartão."
      disabled={!open || !d.planId}
      onSubmit={() => go('loja')}
    >
      {notice ? (
        <p className="t-body rounded-md bg-warning-soft px-4 py-3 text-warning" role="status">
          {notice}
        </p>
      ) : null}
      {!open ? (
        <DuaNote
          pose="horarios"
          title="O cadastro pela internet abre em breve"
          action={
            <ButtonLink to="/entrar" variant="secondary" size="sm">
              já tenho loja, entrar
            </ButtonLink>
          }
        >
          Ainda não dá para criar uma loja por aqui. Enquanto isso, veja o que cada plano tem.
        </DuaNote>
      ) : !plans.billing.available ? (
        <DuaNote pose="seguranca" title="Por enquanto, só com código de acesso">
          Recebeu um código da Venduá? Pode seguir: ele vai na última pergunta.
        </DuaNote>
      ) : null}
      <div role="radiogroup" aria-label="planos" className="grid gap-3 xl:grid-cols-2">
        {plans.plans.map((p) => (
          <PlanOption
            key={p.id}
            plan={p}
            selected={d.planId === p.id}
            onSelect={() => patch({ planId: p.id })}
            address={addressOf(d.slug, plans.storeDomain)}
          />
        ))}
      </div>
    </StepFrame>
  );
}

export function PlanStepSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="carregando os planos">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-6 w-full max-w-md" />
      {[0, 1].map((i) => (
        <div key={i} className="space-y-3 rounded-lg bg-surface p-5 depth-1">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

// ── 2 · loja: name + address ────────────────────────────────────────────────

function useDebounced<T>(v: T, ms: number) {
  const [x, setX] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setX(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return x;
}

const SLUG_WHY: Record<string, string> = {
  taken: 'Esse endereço já tem dono.',
  reserved: 'Esse endereço é reservado da Venduá.',
  invalid: 'Use de 3 a 40 letras sem acento, números ou hífen.',
};

export function StoreStep({ d, patch, go, plans, notice }: FlowProps) {
  const debounced = useDebounced(d.slug, 350);
  const ok = debounced.length >= 3;
  const check = useQuery({
    queryKey: ['signup', 'slug', debounced],
    queryFn: () => api.signup.slug(debounced),
    enabled: ok,
    staleTime: 30_000,
    retry: 1,
  });
  const settled = debounced === d.slug && !check.isFetching;
  const res = settled && check.data?.slug === d.slug ? check.data : null;
  const state: 'idle' | 'checking' | 'free' | 'busy' | 'unknown' =
    d.slug.length < 3
      ? 'idle'
      : !settled
        ? 'checking'
        : res
          ? res.available
            ? 'free'
            : 'busy'
          : check.error
            ? 'unknown'
            : 'checking';
  const name = d.storeName.trim();
  const address = addressOf(d.slug, plans.storeDomain);
  return (
    <StepFrame
      title="Como se chama a sua loja?"
      hint="O nome que seus clientes vão ver, e o endereço da loja na internet."
      back={() => go('plano')}
      // a check that failed (offline blip) doesn't block: Core checks again when creating
      disabled={name.length < 2 || (state !== 'free' && state !== 'unknown')}
      onSubmit={() => go('voce', { praise: `${name}… que nome bonito!` })}
    >
      <Field label="Nome da loja" htmlFor="su-name">
        <TextInput
          id="su-name"
          maxLength={60}
          autoComplete="organization"
          placeholder="Ex.: Doces da Maria"
          value={d.storeName}
          onChange={(e) => {
            const storeName = e.target.value;
            patch(d.slugTouched ? { storeName } : { storeName, slug: slugify(storeName) });
          }}
        />
      </Field>
      <Field
        label="Endereço da loja"
        htmlFor="su-slug"
        error={
          notice ??
          (state === 'busy' ? (SLUG_WHY[res?.reason ?? 'taken'] ?? SLUG_WHY.taken!) : null)
        }
        helper="Só letras sem acento, números e hífen. É o link que você manda para os clientes."
      >
        <TextInput
          id="su-slug"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          placeholder="doces-da-maria"
          value={d.slug}
          aria-invalid={state === 'busy' || undefined}
          onChange={(e) =>
            patch({
              slug: e.target.value
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, ''),
              slugTouched: true,
            })
          }
        />
      </Field>
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg px-4 py-3 ring-1 transition-colors',
          state === 'free'
            ? 'bg-success-soft ring-success/30'
            : state === 'busy'
              ? 'bg-danger-soft ring-danger/30'
              : 'bg-sunken ring-line',
        )}
        aria-live="polite"
      >
        <Globe className="size-5 shrink-0 text-muted" aria-hidden />
        <p className="tnum min-w-0 flex-1 break-all font-semibold">
          <span className="font-normal text-muted">https://</span>
          {address}
        </p>
        <span className="t-caption inline-flex shrink-0 items-center gap-1 font-semibold">
          {state === 'checking' ? (
            <>
              <Spinner className="size-4" /> <span className="text-muted">conferindo</span>
            </>
          ) : state === 'free' ? (
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle weight="fill" className="size-4" /> livre
            </span>
          ) : state === 'busy' ? (
            <span className="inline-flex items-center gap-1 text-danger">
              <WarningCircle weight="fill" className="size-4" /> em uso
            </span>
          ) : null}
        </span>
      </div>
      {state === 'busy' && res?.suggestion ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-body text-muted">Que tal</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => patch({ slug: res.suggestion!, slugTouched: true })}
          >
            usar {res.suggestion}
          </Button>
        </div>
      ) : state === 'unknown' ? (
        <p className="t-caption text-muted">
          Não conseguimos conferir agora. Pode seguir: conferimos de novo ao criar a loja.
        </p>
      ) : null}
    </StepFrame>
  );
}

// ── 3 · você ────────────────────────────────────────────────────────────────

export function YouStep({ d, patch, go, notice }: FlowProps) {
  const [touched, setTouched] = useState(false);
  const name = d.ownerName.trim();
  const email = d.email.trim();
  const emailOk = EMAIL_RE.test(email);
  const first = name.split(/\s+/)[0] ?? '';
  return (
    <StepFrame
      title="E você, como se chama?"
      hint="O e-mail recebe as faturas do plano e também serve para entrar no painel."
      back={() => go('loja')}
      disabled={name.length < 2}
      onSubmit={() => {
        setTouched(true);
        if (emailOk) go('whatsapp', { praise: first ? `Prazer, ${first}!` : null });
      }}
    >
      <Field label="Seu nome" htmlFor="su-owner">
        <TextInput
          id="su-owner"
          maxLength={80}
          autoComplete="name"
          autoCapitalize="words"
          placeholder="Ex.: Maria Souza"
          value={d.ownerName}
          onChange={(e) => patch({ ownerName: e.target.value })}
        />
      </Field>
      <Field
        label="Seu e-mail"
        htmlFor="su-email"
        error={notice ?? (touched && !emailOk ? 'Confira o e-mail, como maria@gmail.com.' : null)}
      >
        <TextInput
          id="su-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          maxLength={200}
          placeholder="maria@gmail.com"
          value={d.email}
          aria-invalid={(touched && !emailOk) || undefined}
          onBlur={() => email && setTouched(true)}
          onChange={(e) => patch({ email: e.target.value })}
        />
      </Field>
    </StepFrame>
  );
}

// ── 4 · WhatsApp + code ─────────────────────────────────────────────────────

export function WhatsappStep({
  d,
  patch,
  go,
  notice,
  onDevCode,
}: FlowProps & { onDevCode: (c: string | null) => void }) {
  const [shown, setShown] = useState(fmtPhone(d.phone));
  const [digits, setDigits] = useState<string | null>(d.phone);
  const [err, setErr] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: (p: string) => api.signup.otpStart(p),
    onSuccess: (r, p) => {
      onDevCode(r.devCode ?? null);
      patch({ phone: p, codeSentAt: Date.now(), codeExpiresAt: expiry(r.expiresAt) });
      go('codigo');
    },
    onError: (e) => setErr(messageOf(e)),
  });
  return (
    <StepFrame
      title="Qual é o seu WhatsApp?"
      hint="Mandamos um código para confirmar. É por ele que você entra no painel, sem senha."
      back={() => go('voce')}
      busy={start.isPending}
      label="receber código"
      onSubmit={() => {
        if (!digits) return setErr('Digite o celular com DDD, como (22) 99999-0000.');
        setErr(null);
        start.mutate(digits);
      }}
    >
      {notice ? (
        <p className="t-body rounded-md bg-warning-soft px-4 py-3 text-warning" role="status">
          {notice}
        </p>
      ) : null}
      <Field
        label={
          <span className="inline-flex items-center gap-2">
            <WhatsappLogo weight="fill" className="size-5 text-success" /> WhatsApp com DDD
          </span>
        }
        htmlFor="su-phone"
        error={err}
      >
        <PhoneInput
          id="su-phone"
          value={shown}
          onChange={(v, dd) => {
            setShown(v);
            setDigits(dd);
          }}
        />
      </Field>
    </StepFrame>
  );
}

const RESEND_AFTER = 30;

export function CodeStep({
  d,
  patch,
  go,
  devCode,
  onVerified,
}: FlowProps & { devCode: string | null; onVerified: (v: Verified) => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<CodeInputHandle>(null);
  const [wait, setWait] = useState(() =>
    Math.max(0, RESEND_AFTER - Math.floor((Date.now() - (d.codeSentAt ?? 0)) / 1000)),
  );
  useEffect(() => {
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const phone = d.phone ?? '';
  const verify = useMutation({
    mutationFn: (c: string) => api.signup.otpVerify(phone, c),
    onSuccess: (r) => {
      haptic.commit();
      const v = { token: r.signupToken, phone, existingStores: r.existingStores };
      saveToken(v);
      onVerified(v);
      go(r.existingStores.length ? 'existente' : 'pagamento', { praise: 'WhatsApp confirmado!' });
    },
    onError: (e) => {
      setErr(messageOf(e));
      setCode('');
      input.current?.focus();
    },
  });
  const resend = useMutation({
    mutationFn: () => api.signup.otpStart(phone),
    onSuccess: (r) => {
      setWait(RESEND_AFTER);
      patch({ codeSentAt: Date.now(), codeExpiresAt: expiry(r.expiresAt) });
    },
    onError: (e) => setErr(messageOf(e)),
  });
  return (
    <StepFrame
      title="Digite o código"
      hint={
        <>
          Enviamos 6 números para o WhatsApp{' '}
          <strong className="whitespace-nowrap text-ink">{fmtPhone(phone)}</strong>.
        </>
      }
      back={() => go('whatsapp')}
      busy={verify.isPending}
      disabled={code.length < 6}
      label="confirmar"
      focusTitle={false}
      onSubmit={() => verify.mutate(code)}
    >
      {devCode ? (
        <p className="t-caption rounded-sm bg-info-soft px-3 py-2 text-info">
          Ambiente de teste: o código é {devCode}
        </p>
      ) : null}
      <div>
        <CodeInput
          ref={input}
          value={code}
          onChange={setCode}
          onComplete={(c) => verify.mutate(c)}
          invalid={!!err}
          onPasteMiss={() => setErr('Não achamos um código de 6 números copiado. Digite o código.')}
        />
        {err ? (
          <p className="t-body mt-3 text-danger" role="alert">
            {err}
          </p>
        ) : null}
      </div>
      <Button
        variant="ghost"
        disabled={wait > 0}
        loading={resend.isPending}
        onClick={() => resend.mutate()}
      >
        {wait > 0 ? `reenviar código em ${wait}s` : 'reenviar código'}
      </Button>
    </StepFrame>
  );
}

// ── 4b · this phone already has stores ──────────────────────────────────────

export function ExistingStep({ d, go, verified }: FlowProps & { verified: Verified }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const enter = useMutation({
    mutationFn: async (s: StoreRef) => {
      const sess = qc.getQueryData<Session>(qk.session);
      // already signed in with this phone: switching is enough
      if (sess?.stores.some((x) => x.id === s.id)) {
        await api.switchStore(s.id);
        await resetClient(qc);
        window.location.assign('/admin/');
        return;
      }
      // the signup code was spent confirming the phone: signing in takes a fresh one
      const r = await api.auth.start(verified.phone);
      savePending({ phone: verified.phone, sentAt: Date.now(), expiresAt: expiry(r.expiresAt) });
      window.location.assign('/admin/entrar');
    },
    onError: (e) => setErr(messageOf(e)),
  });
  const n = verified.existingStores.length;
  return (
    <StepFrame
      title={n === 1 ? 'Esse WhatsApp já tem uma loja' : `Esse WhatsApp já tem ${n} lojas`}
      hint="Quer entrar numa delas ou criar uma loja nova? As duas coisas podem conviver."
      back={() => go('whatsapp')}
      label="criar uma loja nova"
      onSubmit={() => go('pagamento')}
    >
      <ul className="space-y-2">
        {verified.existingStores.map((s) => (
          <li key={s.id}>
            <div className="flex min-h-18 items-center gap-4 rounded-lg bg-surface px-4 py-3 depth-1">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken">
                <Storefront weight="duotone" className="size-6" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="t-caption text-muted">você é {ROLE_LABEL[s.role]}</span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                loading={enter.isPending && enter.variables?.id === s.id}
                disabled={enter.isPending}
                onClick={() => enter.mutate(s)}
              >
                entrar nessa loja
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {err ? (
        <p className="t-body text-danger" role="alert">
          {err}
        </p>
      ) : (
        <p className="t-caption text-muted">
          Para entrar, mandamos um código novo no WhatsApp {fmtPhone(d.phone)}.
        </p>
      )}
    </StepFrame>
  );
}

// ── 5 · payment method → create ─────────────────────────────────────────────

const METHODS = [
  {
    id: 'pix' as const,
    Icon: PixLogo,
    title: 'Pix todo mês',
    body: 'Todo mês chega a fatura com um Pix. Você paga pelo app do banco, em segundos.',
  },
  {
    id: 'card' as const,
    Icon: CreditCard,
    title: 'Cartão de crédito',
    body: 'Cobrança automática todo mês pelo Mercado Pago. O cartão fica guardado só com eles.',
  },
];

/** Where a refused signup sends the merchant back to, from the field Core names. */
function stepFor(e: unknown): { step: StepId; notice: string } | null {
  if (!(e instanceof ApiError)) return null;
  const field = e.field ?? '';
  if (e.code === 'SIGNUP_EXPIRED')
    return {
      step: 'whatsapp',
      notice: 'Passou tempo demais desde o código. Confirme o WhatsApp de novo.',
    };
  if (e.code === 'SLUG_TAKEN')
    return { step: 'loja', notice: 'Esse endereço acabou de ficar indisponível. Escolha outro.' };
  if (field === 'slug')
    return { step: 'loja', notice: 'Esse endereço não pode ser usado. Escolha outro.' };
  if (field === 'storeName')
    return { step: 'loja', notice: 'O nome da loja precisa ter de 2 a 60 letras.' };
  if (field === 'ownerName' || field === 'email')
    return {
      step: 'voce',
      notice: field === 'email' ? 'Confira o e-mail, como maria@gmail.com.' : 'Confira o seu nome.',
    };
  if (e.code === 'UNKNOWN_PLAN' || field === 'planId')
    return { step: 'plano', notice: 'Esse plano mudou. Escolha de novo.' };
  return null;
}

const CREATE_ERR: Record<string, string> = {
  SIGNUP_LIMIT: 'Esse WhatsApp já abriu lojas demais hoje. Tente de novo amanhã.',
  BILLING_UNAVAILABLE: 'O cadastro pela internet ainda não abriu. Tente de novo em breve.',
  INVALID_ACCESS_CODE: 'Esse código não confere. Confira e tente de novo.',
};

export function PayStep({
  d,
  patch,
  go,
  plans,
  verified,
  onCreated,
}: FlowProps & {
  verified: Verified;
  onCreated: (r: Awaited<ReturnType<typeof api.signup.create>>) => void;
}) {
  const plan: Plan | undefined = plans.plans.find((p) => p.id === d.planId);
  const [err, setErr] = useState<string | null>(null);
  const byCode = plans.billing.accessCode && (!plans.billing.available || d.byCode);
  const [code, setCode] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.signup.create({
        signupToken: verified.token,
        planId: d.planId!,
        method: d.method,
        storeName: d.storeName.trim(),
        slug: d.slug,
        ownerName: d.ownerName.trim(),
        email: d.email.trim(),
        ...(byCode ? { accessCode: code.trim() } : {}),
      }),
    onSuccess: onCreated,
    onError: (e) => {
      const back = stepFor(e);
      if (back) go(back.step, { notice: back.notice });
      else setErr((e instanceof ApiError && CREATE_ERR[e.code]) || messageOf(e));
    },
  });
  return (
    <StepFrame
      title={byCode ? 'Qual é o seu código de acesso?' : 'Como prefere pagar o plano?'}
      hint={
        byCode
          ? 'Com o código, a loja abre na hora, sem pagar o plano agora.'
          : 'Dá para trocar depois, em Conta e plano.'
      }
      back={() => go(verified.existingStores.length ? 'existente' : 'whatsapp')}
      busy={create.isPending}
      disabled={!plan || (byCode ? code.trim().length < 12 : !plans.billing.available)}
      label="criar minha loja"
      onSubmit={() => {
        setErr(null);
        create.mutate();
      }}
    >
      {byCode ? (
        <Field label="Código de acesso" htmlFor="su-access" error={err}>
          <TextInput
            id="su-access"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={200}
            lead={<Key className="size-5" aria-hidden />}
            value={code}
            onChange={(e) => {
              setErr(null);
              setCode(e.target.value);
            }}
          />
        </Field>
      ) : (
        <div
          role="radiogroup"
          aria-label="forma de pagamento"
          className="grid gap-3 sm:grid-cols-2"
        >
          {METHODS.map((m) => {
            const on = d.method === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  haptic.tick();
                  patch({ method: m.id });
                }}
                className={cn(
                  'flex items-start gap-3 rounded-lg bg-surface p-4 text-left depth-1 transition-[box-shadow,background-color] hover:bg-hover',
                  on ? 'ring-2 ring-primary' : 'ring-1 ring-line',
                )}
              >
                <span
                  className={cn(
                    'grid size-11 shrink-0 place-items-center rounded-full',
                    on ? 'bg-spark text-on-spark' : 'bg-sunken',
                  )}
                >
                  <m.Icon weight="duotone" className="size-6" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{m.title}</span>
                  <span className="t-body mt-0.5 block text-muted">{m.body}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {plans.billing.available && plans.billing.accessCode ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mx-3.5"
          onClick={() => {
            setErr(null);
            patch({ byCode: !d.byCode });
          }}
        >
          {byCode ? 'prefiro pagar o plano' : 'tenho um código de acesso'}
        </Button>
      ) : null}
      {plan ? (
        <div className="rounded-lg bg-sunken p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold">{plan.name}</p>
            {byCode ? null : (
              <p className="tnum font-display text-lg font-semibold">{perMonth(plan)}</p>
            )}
          </div>
          <p className="t-body mt-2 text-muted">
            {byCode
              ? 'A loja abre assim que for criada. Depois, é só montar o cardápio.'
              : 'A loja abre para pedidos assim que o primeiro pagamento entrar. Enquanto isso, você já monta o cardápio.'}
          </p>
          {plan.feeBps === 0 ? (
            <p className="t-caption mt-2 text-muted">
              Nenhuma taxa da Venduá por pedido. O Mercado Pago cobra a tarifa dele nos pagamentos
              online dos seus clientes.
            </p>
          ) : null}
        </div>
      ) : null}
      {err && !byCode ? (
        <p className="t-body text-danger" role="alert">
          {err}
        </p>
      ) : null}
    </StepFrame>
  );
}

/** A short "o que você escolheu" beside the questions on desktop: the store taking shape. */
export function Summary({ d, plans }: { d: Draft; plans: PlansData | undefined }) {
  const plan = plans?.plans.find((p) => p.id === d.planId);
  const rows: { label: string; value: string | null }[] = [
    {
      label: 'Plano',
      value: plan
        ? `${plan.name}${plan.priceCents !== null ? ` · ${money(plan.priceCents)}/mês` : ''}`
        : null,
    },
    { label: 'Dono', value: d.ownerName.trim() || null },
    { label: 'WhatsApp', value: d.phone ? fmtPhone(d.phone) : null },
    {
      label: 'Pagamento',
      value:
        d.step === 'pagamento' || d.created
          ? d.created?.next.kind === 'open' ||
            (!d.created && plans?.billing.accessCode && (!plans.billing.available || d.byCode))
            ? 'Código de acesso'
            : d.method === 'pix'
              ? 'Pix todo mês'
              : 'Cartão'
          : null,
    },
  ];
  return (
    <div className="overflow-hidden rounded-xl bg-surface depth-2">
      <div className="flex items-center gap-2 border-b border-line bg-sunken px-4 py-3">
        <span className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2.5 rounded-full bg-line-strong" />
          ))}
        </span>
        <p className="t-caption tnum min-w-0 flex-1 truncate rounded-full bg-surface px-3 py-1 text-muted">
          {addressOf(d.slug, plans?.storeDomain ?? 'vendua.com.br')}
        </p>
      </div>
      <div className="p-6">
        <span className="grid size-14 place-items-center rounded-full bg-spark-soft">
          <Storefront weight="duotone" className="size-7" aria-hidden />
        </span>
        <p className={cn('t-title-1 mt-4 break-words', !d.storeName.trim() && 'text-faint')}>
          {d.storeName.trim() || 'Sua loja'}
        </p>
        <dl className="mt-5 space-y-3">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-4">
              <dt className="t-caption text-muted">{r.label}</dt>
              <dd
                className={cn(
                  't-body min-w-0 text-right',
                  r.value ? 'animate-fade-up font-semibold' : 'text-faint',
                )}
              >
                {r.value ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
