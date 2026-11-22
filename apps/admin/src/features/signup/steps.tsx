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
import {
  api,
  ApiError,
  withRetryScope,
  type Plan,
  type Session,
  type StoreRef,
} from '../../lib/api.ts';
import { money, phone as fmtPhone } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { parseDocument } from '../../lib/parse.ts';
import { resetClient } from '../../lib/persist.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { ROLE_LABEL } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { CodeInput, type CodeInputHandle } from '../../ui/CodeInput.tsx';
import { DuaNote, messageOf, Skeleton } from '../../ui/feedback.tsx';
import { DocumentInput, Field, PhoneInput, TextInput } from '../../ui/fields.tsx';
import { perMonth, publicPlans } from '../../ui/PlanCard.tsx';
import { CLOSED_LINE, PlanCompare, promiseOf } from '../../ui/PlanPicker.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { StepFrame } from '../../ui/StepFrame.tsx';
import { DOCUMENT_ERR, PAYER_EMAIL_RE, expiry, savePending } from '../auth/pending.ts';
import { SegmentPicker } from '../onboarding/SegmentPicker.tsx';
import { MiniStore } from '../onboarding/MiniStore.tsx';
import { GENERIC, segmentOf } from '../onboarding/segments.ts';
import { CouponField, couponError, discountLine, useSignupCoupon } from './coupon.tsx';
import { ReferralNote, useSignupReferral } from './referral.tsx';
import { saveToken, type Draft, type StepId, type Verified } from './progress.ts';
import { appPath } from '../../app/paths.ts';
import { platform } from '../../platform/index.ts';

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

export function SignupSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="carregando">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-6 w-full max-w-md" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
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
  // until it's edited, the address follows the name, folded by Core (the slug it will store)
  const source = d.slugTouched ? d.slug : d.storeName.trim();
  const debounced = useDebounced(source, 350);
  const check = useQuery({
    queryKey: ['signup', 'slug', debounced],
    queryFn: () => api.signup.slug(debounced),
    enabled: d.slugTouched ? debounced.length >= 3 : debounced.length > 0,
    staleTime: 30_000,
    retry: 1,
  });
  const settled = debounced === source && !check.isFetching;
  const res = settled && check.data ? check.data : null;
  useEffect(() => {
    if (!d.slugTouched && !source && d.slug) patch({ slug: '' });
    else if (!d.slugTouched && res && res.slug !== d.slug) patch({ slug: res.slug });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.slugTouched, source, res?.slug]);
  const slug = res?.slug ?? d.slug;
  const state: 'idle' | 'checking' | 'free' | 'busy' | 'unknown' =
    slug.length < 3
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
  const open = plans.signup.open;
  // the address follows the name by itself: it opens for editing only when asked, or when
  // there's something to fix in it
  const [editSlug, setEditSlug] = useState(d.slugTouched || !!notice);
  const slugOpen = editSlug || state === 'busy';
  const [tried, setTried] = useState(false);
  const missing =
    name.length < 2
      ? 'Escreva o nome da loja.'
      : state !== 'free' && state !== 'unknown'
        ? state === 'checking'
          ? 'Conferindo o endereço…'
          : 'Escolha outro endereço.'
        : !d.segment
          ? 'Toque no que a loja vende.'
          : null;
  return (
    <StepFrame
      title="Como se chama a sua loja?"
      hint="O nome que o cliente vê e o que você vende. Com isso eu já deixo horários e exemplos do seu jeito."
      // a check that failed (offline blip) doesn't block: Core checks again when creating
      disabled={!open || !!missing}
      why={tried ? missing : undefined}
      onSubmit={() => {
        setTried(true);
        go('voce', { praise: segmentOf(d.segment)?.praise ?? `${name}… que nome bonito!` });
      }}
    >
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
          Ainda não dá para criar uma loja por aqui.
        </DuaNote>
      ) : null}
      <Field label="Nome da loja" htmlFor="su-name">
        <TextInput
          id="su-name"
          maxLength={60}
          autoComplete="off"
          autoCapitalize="words"
          placeholder="Ex.: Doces da Maria"
          value={d.storeName}
          onChange={(e) => {
            patch({ storeName: e.target.value });
          }}
        />
      </Field>
      {slugOpen ? (
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
            // what was typed becomes the address Core will store ("doces-" → "doces")
            onBlur={() => res && res.slug !== d.slug && patch({ slug: res.slug })}
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
      ) : null}
      {name || slugOpen ? (
        <div
          className={cn(
            '-mt-2 flex items-center gap-3 rounded-lg px-4 py-2.5 ring-1 transition-colors',
            state === 'free'
              ? 'bg-success-soft ring-success/30'
              : state === 'busy'
                ? 'bg-danger-soft ring-danger/30'
                : 'bg-sunken ring-line',
          )}
          aria-live="polite"
        >
          <Globe className="size-5 shrink-0 text-muted" aria-hidden />
          <p className="tnum min-w-0 flex-1 text-[0.9375rem]">
            <span className="break-all font-semibold">{slug || 'sualoja'}</span>
            <wbr />
            <span className="text-muted">.{plans.storeDomain}</span>
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
          {slugOpen ? null : (
            <button
              type="button"
              onClick={() => setEditSlug(true)}
              className="t-label -my-1 -mr-2 inline-flex min-h-11 items-center rounded-md px-2 text-muted underline underline-offset-2 hover:text-ink"
            >
              mudar
            </button>
          )}
        </div>
      ) : null}
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
      <fieldset className="space-y-3 pt-1">
        <legend className="t-label mb-3">O que a loja vende?</legend>
        <SegmentPicker compact value={d.segment} onPick={(id) => patch({ segment: id })} />
      </fieldset>
    </StepFrame>
  );
}

// ── 2 · você + WhatsApp → the code ──────────────────────────────────────────

export function YouStep({
  d,
  patch,
  go,
  notice,
  onDevCode,
}: FlowProps & { onDevCode: (c: string | null) => void }) {
  const [touched, setTouched] = useState(false);
  const [docTouched, setDocTouched] = useState(false);
  const [shown, setShown] = useState(fmtPhone(d.phone));
  const [digits, setDigits] = useState<string | null>(d.phone);
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const name = d.ownerName.trim();
  const email = d.email.trim();
  const emailOk = PAYER_EMAIL_RE.test(email);
  const docOk = parseDocument(d.document) !== null;
  // Core sent us back here for the document or the phone: its notice goes on that field
  const docNotice = notice === DOCUMENT_ERR ? notice : null;
  const emailNotice = notice && /e-mail/i.test(notice) ? notice : null;
  const topNotice = notice && !docNotice && !emailNotice ? notice : null;
  const first = name.split(/\s+/)[0] ?? '';
  const start = useMutation({
    mutationFn: (p: string) => api.signup.otpStart(p),
    onSuccess: (r, p) => {
      onDevCode(r.devCode ?? null);
      patch({ phone: p, codeSentAt: Date.now(), codeExpiresAt: expiry(r.expiresAt) });
      go('codigo', { praise: first ? `Prazer, ${first}!` : null });
    },
    onError: (e) =>
      setPhoneErr(
        e instanceof ApiError && e.code === 'SIGNUP_CLOSED'
          ? CREATE_ERR.SIGNUP_CLOSED!
          : messageOf(e),
      ),
  });
  return (
    <StepFrame
      title="E você, como se chama?"
      hint="Seu WhatsApp é a sua senha: mando um código para confirmar. O e-mail e o CPF ou CNPJ vão na cobrança do plano."
      back={() => go('loja')}
      busy={start.isPending}
      disabled={name.length < 2}
      why="Escreva o seu nome."
      label="receber código no WhatsApp"
      onSubmit={() => {
        setTouched(true);
        setDocTouched(true);
        if (!digits) setPhoneErr('Digite o celular com DDD, como (22) 99999-0000.');
        if (!emailOk || !docOk || !digits) return;
        setPhoneErr(null);
        start.mutate(digits);
      }}
    >
      {topNotice ? (
        <p className="t-body rounded-md bg-warning-soft px-4 py-3 text-warning" role="status">
          {topNotice}
        </p>
      ) : null}
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
        label={
          <span className="inline-flex items-center gap-2">
            <WhatsappLogo weight="fill" className="size-5 text-success" aria-hidden /> Seu WhatsApp,
            com DDD
          </span>
        }
        htmlFor="su-phone"
        error={phoneErr}
      >
        <PhoneInput
          id="su-phone"
          value={shown}
          onChange={(v, dd) => {
            setShown(v);
            setDigits(dd);
            setPhoneErr(null);
          }}
        />
      </Field>
      <Field
        label="Seu e-mail"
        htmlFor="su-email"
        error={
          emailNotice ??
          (touched && !emailOk
            ? /[^\x20-\x7e]/.test(email)
              ? 'Escreva o e-mail sem acento nem ç, como maria@gmail.com.'
              : 'Confira o e-mail, como maria@gmail.com.'
            : null)
        }
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
      <Field
        label="CPF ou CNPJ"
        htmlFor="su-doc"
        error={docNotice ?? (docTouched && !docOk ? DOCUMENT_ERR : null)}
      >
        <DocumentInput
          id="su-doc"
          value={d.document}
          invalid={docTouched && !docOk}
          onBlur={() => d.document && setDocTouched(true)}
          onChange={(v) => patch({ document: v })}
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
      const v = {
        token: r.signupToken,
        phone,
        existingStores: r.existingStores,
        trialEligible: r.trialEligible,
      };
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
      back={() => go('voce')}
      busy={verify.isPending}
      disabled={!/^\d{6}$/.test(code)}
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
    mutationFn: async (s: StoreRef, ctx) => {
      const sess = qc.getQueryData<Session>(qk.session);
      // already signed in with this phone: switching is enough
      if (sess?.stores.some((x) => x.id === s.id)) {
        await withRetryScope(ctx, () => api.switchStore(s.id));
        await platform.push.disable().catch(() => undefined);
        await resetClient(qc);
        window.location.assign(appPath('/'));
        return;
      }
      // the signup code was spent confirming the phone: signing in takes a fresh one
      const r = await api.auth.start(verified.phone);
      savePending({ phone: verified.phone, sentAt: Date.now(), expiresAt: expiry(r.expiresAt) });
      window.location.assign(appPath('/entrar'));
    },
    onError: (e) => setErr(messageOf(e)),
  });
  const n = verified.existingStores.length;
  return (
    <StepFrame
      title={n === 1 ? 'Esse WhatsApp já tem uma loja' : `Esse WhatsApp já tem ${n} lojas`}
      hint="Quer entrar numa delas ou criar uma loja nova? As duas coisas podem conviver."
      back={() => go('voce')}
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

/** The trial, told as what happens when: today, the reminder, the first month. */
function TrialPlan({
  plan,
  days,
  firstMonths,
}: {
  plan: Plan;
  days: number;
  /** a coupon's discount on the first paid months, worded (Core's amounts) */
  firstMonths?: string | null | undefined;
}) {
  const end = new Date(Date.now() + days * 86_400_000);
  const nudge = new Date(end.getTime() - 3 * 86_400_000);
  const day = (x: Date) => x.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  const steps = [
    { when: 'Hoje', what: 'A loja abre para pedidos. Nada é cobrado e nenhum cartão é pedido.' },
    { when: day(nudge), what: 'A gente avisa no WhatsApp que o teste está acabando.' },
    {
      when: day(end),
      what: firstMonths
        ? `Começa o ${plan.name} com o desconto do cupom: ${firstMonths}. Pix ou cartão, você escolhe em Conta.`
        : `Começa o ${plan.name}${perMonth(plan) ? `, ${perMonth(plan)}` : ''}, com Pix ou cartão: você escolhe em Conta.`,
    },
  ];
  return (
    <div className="space-y-4">
      <ol className="relative space-y-4 rounded-lg bg-surface p-5 depth-1">
        {steps.map((st, i) => (
          <li key={st.when} className="flex gap-3">
            <span
              className={cn(
                'tnum grid size-8 shrink-0 place-items-center rounded-full font-display font-semibold',
                i === 0 ? 'bg-success text-on-primary' : 'bg-sunken',
              )}
              aria-hidden
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">{st.when}</span>
              <span className="t-body block text-muted">{st.what}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="t-caption text-muted">
        Se não quiser continuar, é só não pagar: a loja pausa os pedidos e nada é cobrado. Nenhuma
        taxa da Venduá por pedido, nem no teste.
      </p>
    </div>
  );
}

/** Where a refused signup sends the merchant back to, from the field Core names. */
function stepFor(e: unknown): { step: StepId; notice: string } | null {
  if (!(e instanceof ApiError)) return null;
  const field = e.field ?? '';
  if (e.code === 'SIGNUP_EXPIRED')
    return {
      step: 'voce',
      notice: 'Passou tempo demais desde o código. Confirme o WhatsApp de novo.',
    };
  if (e.code === 'SLUG_TAKEN')
    return { step: 'loja', notice: 'Esse endereço acabou de ficar indisponível. Escolha outro.' };
  if (field === 'slug')
    return { step: 'loja', notice: 'Esse endereço não pode ser usado. Escolha outro.' };
  if (field === 'storeName')
    return { step: 'loja', notice: 'O nome da loja precisa ter de 2 a 60 letras.' };
  if (field === 'ownerName' || field === 'email' || field === 'document')
    return {
      step: 'voce',
      notice:
        field === 'email'
          ? 'Confira o e-mail, como maria@gmail.com.'
          : field === 'document'
            ? DOCUMENT_ERR
            : 'Confira o seu nome.',
    };
  if (field === 'segment') return { step: 'loja', notice: 'Escolha de novo o que a loja vende.' };
  if (e.code === 'PLAN_UNAVAILABLE')
    return {
      step: 'pagamento',
      notice: 'Esse plano ainda não está aberto para assinatura. Escolha outro.',
    };
  if (e.code === 'UNKNOWN_PLAN' || field === 'planId')
    return { step: 'pagamento', notice: 'Esse plano mudou. Escolha de novo.' };
  return null;
}

const CREATE_ERR: Record<string, string> = {
  SIGNUP_LIMIT: 'Esse WhatsApp já abriu lojas demais hoje. Tente de novo amanhã.',
  BILLING_UNAVAILABLE: 'O cadastro pela internet ainda não abriu. Tente de novo em breve.',
  BILLING_PROVIDER_ERROR:
    'O Mercado Pago não gerou a cobrança agora. A equipe da Venduá já foi avisada. Tente de novo em alguns minutos.',
  SIGNUP_CLOSED: 'O cadastro pela internet está fechado agora. Tente de novo mais tarde.',
  INVALID_ACCESS_CODE: 'Esse código não confere. Confira e tente de novo.',
};

/**
 * The plan, on the last screen: the chosen one as a single row (the site's pick, or the one with
 * the trial) with "trocar"; open, every public plan as a compact radio row and the comparison.
 */
function PlanChoice({
  plans,
  selected,
  onSelect,
  trial,
}: {
  plans: PlansData;
  selected: string | null;
  onSelect: (id: string) => void;
  /** the free days show beside the plans that have them */
  trial: boolean;
}) {
  const list = publicPlans(plans.plans);
  const chosen = list.find((p) => p.id === selected);
  const [open, setOpen] = useState(!chosen);
  const row = (p: Plan, on: boolean) => (
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{p.name}</span>
        <span className="tnum shrink-0 font-display font-semibold">{perMonth(p)}</span>
      </span>
      <span className="mt-1 flex items-start justify-between gap-3">
        <span className="t-caption min-w-0 text-muted">
          {p.available ? promiseOf(p) : CLOSED_LINE}
        </span>
        {on ? (
          <CheckCircle weight="fill" className="size-6 shrink-0 text-primary" aria-hidden />
        ) : trial && p.available && p.trialDays > 0 ? (
          <span className="t-caption shrink-0 font-semibold text-success">
            {p.trialDays} dias grátis
          </span>
        ) : null}
      </span>
      {p.recommended ? (
        <span className="t-caption mt-2 inline-block rounded-full bg-spark px-2 py-0.5 font-semibold text-on-spark">
          recomendado
        </span>
      ) : null}
    </span>
  );
  if (!open && chosen)
    return (
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="t-label">Seu plano</p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="t-label -my-2 -mr-2 inline-flex min-h-11 items-center rounded-md px-2 underline underline-offset-2 hover:bg-hover"
          >
            ver os planos
          </button>
        </div>
        <div className="flex rounded-lg bg-surface p-4 ring-1 ring-line depth-1">
          {row(chosen, false)}
        </div>
      </div>
    );
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="planos" className="space-y-2">
        {list.map((p) => {
          const on = p.id === selected;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!p.available}
              onClick={() => {
                haptic.tick();
                onSelect(p.id);
              }}
              className={cn(
                'press flex w-full items-center gap-3 rounded-lg bg-surface p-4 text-left transition-[box-shadow,background-color] hover:bg-hover disabled:opacity-60',
                on ? 'ring-2 ring-primary depth-1' : 'ring-1 ring-line',
              )}
            >
              {row(p, on)}
            </button>
          );
        })}
      </div>
      <PlanCompare plans={plans.plans} trial={trial} />
    </div>
  );
}

export function PayStep({
  d,
  patch,
  go,
  plans,
  notice,
  verified,
  onCreated,
}: FlowProps & {
  verified: Verified;
  onCreated: (r: Awaited<ReturnType<typeof api.signup.create>>) => void;
}) {
  const plan: Plan | undefined = plans.plans.find((p) => p.id === d.planId);
  const [err, setErr] = useState<string | null>(null);
  // a coupon (ADR 0042): Core says what it gives on this plan; its free days replace the trial
  const coupon = useSignupCoupon(d.coupon, d.planId);
  const [couponErr, setCouponErr] = useState<string | null>(null);
  const applied = d.coupon && coupon.data && !coupon.isError && !couponErr ? coupon.data : null;
  const couponDays = applied?.coupon.freeDays ?? 0;
  // a store's referral (migration 0120): a welcome month on top of the trial, once per WhatsApp;
  // a coupon's free days win over it
  const referral = useSignupReferral(d.referral, d.planId, verified.token);
  const welcomeDays =
    !couponDays && !d.byCode && plans.billing.available && referral.data?.referral.kind === 'store'
      ? referral.data.referral.welcomeDays
      : 0;
  // Core refuses free days with an access code (COUPON_NEEDS_BILLING): with billing on, the
  // coupon's free days win over the code the owner picked
  const codeChosen = d.byCode && !(couponDays > 0 && plans.billing.available);
  const byCode = plans.billing.accessCode && (!plans.billing.available || codeChosen);
  const [code, setCode] = useState('');
  // a parallel signup from this phone took its one trial meanwhile: pay like any other
  const [trialLost, setTrialLost] = useState(false);
  const planTrialDays = plan?.trialDays ?? 0;
  const firstMonths = applied ? discountLine(applied) : null;
  const planTrial =
    !byCode &&
    plans.billing.available &&
    planTrialDays > 0 &&
    !!verified.trialEligible &&
    !trialLost;
  const freeDays = couponDays || welcomeDays;
  const trial = freeDays > 0 || planTrial;
  const trialDays = freeDays || planTrialDays;
  // a coupon still being checked, or refused: fix or take it off before creating the store
  const couponPending = !!d.coupon && !applied;
  const create = useMutation({
    mutationFn: () =>
      api.signup.create({
        signupToken: verified.token,
        planId: d.planId!,
        ...(freeDays ? {} : trial ? { trial: true } : { method: d.method }),
        ...(applied ? { coupon: d.coupon! } : {}),
        // an unknown code is dropped by Core, never in the way
        ...(d.referral && referral.data ? { referral: d.referral } : {}),
        storeName: d.storeName.trim(),
        slug: d.slug,
        ownerName: d.ownerName.trim(),
        email: d.email.trim(),
        document: d.document,
        ...(d.segment ? { segment: d.segment } : {}),
        ...(byCode ? { accessCode: code.trim() } : {}),
      }),
    onSuccess: onCreated,
    onError: (e) => {
      if (e instanceof ApiError && e.code.startsWith('COUPON_'))
        return setCouponErr(couponError(e));
      if (e instanceof ApiError && e.code === 'REFERRAL_CHANGED') {
        void referral.refetch();
        return setErr('A indicação mudou enquanto você respondia. Confira e tente de novo.');
      }
      if (e instanceof ApiError && e.code === 'TRIAL_USED') {
        setTrialLost(true);
        return setErr('Esse WhatsApp já usou o teste grátis em outra loja. Escolha como pagar.');
      }
      const back = stepFor(e);
      if (back) go(back.step, { notice: back.notice });
      else setErr((e instanceof ApiError && CREATE_ERR[e.code]) || messageOf(e));
    },
  });
  const couponField = (
    <CouponField
      code={d.coupon}
      planId={d.planId}
      error={couponErr}
      onChange={(c) => {
        setCouponErr(null);
        patch({ coupon: c });
      }}
    />
  );
  return (
    <StepFrame
      title={
        byCode
          ? 'Qual é o seu código de acesso?'
          : trial
            ? `Comece com ${trialDays} dias grátis`
            : 'Como prefere pagar o plano?'
      }
      hint={
        byCode
          ? 'Com o código, você cria a loja agora e acerta o pagamento do plano com a equipe da Venduá.'
          : couponDays
            ? 'Presente do cupom: sem cartão e sem cobrança agora. A loja já abre para pedidos.'
            : welcomeDays
              ? `Presente da indicação da ${referral.data?.referral.name}: sem cartão e sem cobrança agora. A loja já abre para pedidos.`
              : trial
                ? 'Sem cartão e sem cobrança agora: a loja já abre para pedidos.'
                : 'Dá para trocar depois, em Conta e plano.'
      }
      back={() => go(verified.existingStores.length ? 'existente' : 'voce')}
      busy={create.isPending}
      disabled={
        !plan?.available ||
        couponPending ||
        (byCode ? code.trim().length < 12 : !plans.billing.available)
      }
      label={
        freeDays
          ? 'começar meus dias grátis'
          : trial
            ? 'começar meu teste grátis'
            : 'criar minha loja'
      }
      onSubmit={() => {
        setErr(null);
        create.mutate();
      }}
    >
      {notice ? (
        <p className="t-body rounded-md bg-warning-soft px-4 py-3 text-warning" role="status">
          {notice}
        </p>
      ) : null}
      {referral.data ? <ReferralNote referral={referral.data.referral} /> : null}
      <PlanChoice
        plans={plans}
        selected={d.planId}
        onSelect={(planId) => patch({ planId })}
        trial={!byCode && plans.billing.available && !!verified.trialEligible && !trialLost}
      />
      {/* an applied coupon is why this step reads as it does: it leads */}
      {d.coupon ? couponField : null}
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
      ) : trial && plan ? (
        <TrialPlan plan={plan} days={trialDays} firstMonths={firstMonths} />
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
      {d.coupon ? null : couponField}
      {plans.billing.available && plans.billing.accessCode && !couponDays ? (
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
      {!trial && trialDays > 0 && verified.trialEligible === false && !byCode ? (
        <p className="t-body text-muted">
          Esse WhatsApp já usou o teste grátis em outra loja, então esta começa pelo primeiro mês.
        </p>
      ) : null}
      {plan && !trial ? (
        <div className="space-y-2 rounded-lg bg-sunken p-4">
          {applied?.discountedCents != null ? (
            <p className="flex items-baseline gap-2">
              <s className="tnum text-muted">{perMonth(plan)}</s>
              <span className="tnum font-display text-lg font-semibold text-success">
                {money(applied.discountedCents)}/mês
              </span>
            </p>
          ) : null}
          {firstMonths ? <p className="t-body font-semibold">{firstMonths}</p> : null}
          <p className="t-body text-muted">
            {byCode
              ? 'A loja abre para pedidos quando a equipe confirmar o pagamento. Enquanto isso, você já monta o cardápio.'
              : 'A loja abre para pedidos assim que o primeiro pagamento entrar. Enquanto isso, você já monta o cardápio.'}
          </p>
          {plan.feeBps === 0 ? (
            <p className="t-caption text-muted">
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

const NO_WEEK = Array.from({ length: 7 }, () => []);

/**
 * Beside the questions on desktop: the same phone the onboarding builds the store in, already
 * with its name and address, and a short receipt of what was chosen.
 */
export function Summary({
  d,
  plans,
  trial = 0,
}: {
  d: Draft;
  plans: PlansData | undefined;
  /** the free days this signup starts with (0: it pays from the start) */
  trial?: number;
}) {
  const plan = plans?.plans.find((p) => p.id === d.planId);
  const seg = segmentOf(d.segment);
  const rows: { label: string; value: string | null }[] = [
    {
      label: 'Plano',
      value: plan
        ? `${plan.name}${plan.priceCents !== null ? ` · ${money(plan.priceCents)}/mês` : ''}`
        : null,
    },
    { label: 'Vende', value: seg?.label ?? null },
    { label: 'Dono', value: d.ownerName.trim() || null },
    { label: 'WhatsApp', value: d.phone ? fmtPhone(d.phone) : null },
    {
      label: 'Pagamento',
      value:
        d.step === 'pagamento' || d.created
          ? trial > 0
            ? `${trial} dias grátis`
            : d.created?.next.kind === 'manual' ||
                (!d.created && plans?.billing.accessCode && (!plans.billing.available || d.byCode))
              ? 'Código de acesso'
              : d.method === 'pix'
                ? 'Pix todo mês'
                : 'Cartão'
          : null,
    },
  ];
  return (
    <div className="space-y-4">
      <div className="mx-auto max-w-[260px]">
        <MiniStore
          draft={{
            name: d.storeName,
            tagline: '',
            logoUrl: null,
            week: NO_WEEK,
            pickup: false,
            delivery: false,
            accent: null,
            onAccent: null,
          }}
          products={[]}
          whatsapp={false}
          timeZone="America/Sao_Paulo"
          specialDays={[]}
          url={addressOf(d.slug, plans?.storeDomain ?? 'vendua.com.br')}
          examples={(seg ?? GENERIC).examples}
        />
      </div>
      <dl className="space-y-2 rounded-lg bg-surface p-4 depth-1">
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
  );
}
