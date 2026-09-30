import {
  ArrowLeft,
  ArrowRight,
  CaretRight,
  EnvelopeSimple,
  Storefront,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type SignInResult, type StoreRef } from '../../lib/api.ts';
import { phone as fmtPhone } from '../../lib/format.ts';
import { resetClient } from '../../lib/persist.ts';
import { applyUpdate, checkForUpdate, onUpdate, updateReady } from '../../lib/pwa.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { ROLE_LABEL } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { CodeInput, type CodeInputHandle } from '../../ui/CodeInput.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Field, PhoneInput, TextInput } from '../../ui/fields.tsx';
import { Mascote, type Pose } from '../../ui/Mascote.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { useKeyboardInset } from '../../ui/StepFrame.tsx';
import { EMAIL_RE, expiry, loadPending, savePending } from './pending.ts';

type Step =
  | { kind: 'phone' }
  | { kind: 'code'; phone: string; sentAt: number; devCode?: string }
  | { kind: 'pick'; token: string; stores: StoreRef[] }
  | { kind: 'email' }
  | { kind: 'emailSent'; email: string; sentAt: number; devLink?: string }
  | { kind: 'link'; token: string };

function firstStep(): Step {
  const link = new URLSearchParams(window.location.search).get('link');
  if (link) return { kind: 'link', token: link.slice(0, 200) };
  const p = loadPending();
  return p ? { kind: 'code', phone: p.phone, sentAt: p.sentAt } : { kind: 'phone' };
}

/** Sign in with the phone (a 6-digit code on WhatsApp) or an e-mail link; no password (ADR 0020). */
export function Login() {
  const [step, setStep] = useState<Step>(firstStep);
  const qc = useQueryClient();
  useKeyboardInset();
  // Signed out is the one moment a new version costs nothing: take it here, not with a banner.
  // At once on arrival; later only while the merchant is away (reading the code in WhatsApp),
  // since the code step survives a reload. Not while picking a store or opening an e-mail link:
  // those tokens live in memory (and a link works once).
  const holding = useRef(false);
  holding.current = step.kind === 'pick' || step.kind === 'link';
  useEffect(() => {
    const take = () => {
      if (updateReady() && !holding.current) applyUpdate();
    };
    take();
    checkForUpdate();
    const away = () => {
      if (document.visibilityState === 'hidden') take();
    };
    const off = onUpdate(away);
    document.addEventListener('visibilitychange', away);
    return () => {
      off();
      document.removeEventListener('visibilitychange', away);
    };
  }, []);
  const enter = async () => {
    savePending(null);
    // an e-mail link opened while another store was signed in: nothing of it may carry over
    if (qc.getQueryData(qk.session)) {
      await resetClient(qc);
      window.location.assign('/admin/');
      return;
    }
    void qc.invalidateQueries({ queryKey: qk.session });
    window.history.replaceState(null, '', '/admin/');
  };
  const signedIn = (r: SignInResult) =>
    r.signedIn ? void enter() : setStep({ kind: 'pick', token: r.pickerToken, stores: r.stores });
  return (
    <div className="flex min-h-dvh flex-col md:items-center md:justify-center md:py-10">
      {step.kind === 'phone' ? (
        <PhoneStep
          onSent={(phone, expiresAt, devCode) => {
            const sentAt = Date.now();
            savePending({ phone, sentAt, expiresAt: expiry(expiresAt) });
            setStep({ kind: 'code', phone, sentAt, ...(devCode ? { devCode } : {}) });
          }}
          onEmail={() => setStep({ kind: 'email' })}
        />
      ) : step.kind === 'code' ? (
        <CodeStep
          phone={step.phone}
          sentAt={step.sentAt}
          devCode={step.devCode}
          onBack={() => {
            savePending(null);
            setStep({ kind: 'phone' });
          }}
          onResent={(expiresAt) =>
            savePending({ phone: step.phone, sentAt: Date.now(), expiresAt: expiry(expiresAt) })
          }
          onSignedIn={signedIn}
        />
      ) : step.kind === 'email' ? (
        <EmailStep
          onBack={() => setStep({ kind: 'phone' })}
          onSent={(email, devLink) =>
            setStep({
              kind: 'emailSent',
              email,
              sentAt: Date.now(),
              ...(devLink ? { devLink } : {}),
            })
          }
        />
      ) : step.kind === 'emailSent' ? (
        <EmailSentStep
          email={step.email}
          sentAt={step.sentAt}
          devLink={step.devLink}
          onOther={() => setStep({ kind: 'email' })}
          onWhatsapp={() => setStep({ kind: 'phone' })}
        />
      ) : step.kind === 'link' ? (
        <LinkStep
          token={step.token}
          onSignedIn={signedIn}
          onAgain={() => setStep({ kind: 'email' })}
          onWhatsapp={() => setStep({ kind: 'phone' })}
        />
      ) : (
        <PickStep token={step.token} stores={step.stores} onDone={() => void enter()} />
      )}
    </div>
  );
}

/**
 * Every step is the same scene: Duá stands behind the counter (the sheet the form sits on,
 * anchored to the bottom where the thumb is), in front of a lime sun rising behind it. Duá
 * takes whatever height the phone has left, so the form never moves away from the hand.
 */
function Counter({
  pose,
  title,
  lead,
  back,
  children,
}: {
  pose: Pose;
  title: ReactNode;
  lead?: ReactNode;
  back?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="animate-fade-up flex w-full flex-1 flex-col md:w-[440px] md:flex-none">
      <div className="flex flex-1 flex-col px-5 pt-[calc(0.5rem+env(safe-area-inset-top))] md:px-2 md:pt-0">
        <p className="flex min-h-12 items-center font-display text-xl font-semibold tracking-tight">
          venduá
        </p>
        {/* spare height: mostly to Duá, the rest above the title once Duá is full size */}
        <div className="min-h-2 grow basis-0 md:hidden" />
        <div className="flex flex-col">
          {back}
          <h1 className="font-display text-[2.25rem] font-semibold leading-[2.5rem] tracking-[-0.025em]">
            {title}
          </h1>
          {lead ? <p className="t-body-lg mt-2 max-w-[34ch] text-muted">{lead}</p> : null}
        </div>
        <div
          aria-hidden
          className="relative mt-3 max-h-64 min-h-32 grow-[4] basis-0 md:mt-6 md:h-60 md:flex-none"
        >
          <span className="absolute bottom-0 left-1/2 aspect-square w-[min(80%,300px)] -translate-x-1/2 translate-y-1/2 rounded-full bg-spark" />
          {/* the art's bust ends in a rounded edge: sink it behind the counter, never above it */}
          <div className="absolute inset-x-0 bottom-0 mx-auto aspect-square h-full max-h-64 max-w-full translate-y-[16%]">
            <Mascote pose={pose} size={240} className="animate-rise w-full" />
          </div>
          {/* the counter's shadow on Duá: standing behind it, not cut off by it */}
          <span className="absolute -bottom-1 left-1/2 h-14 w-[min(96%,360px)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_bottom,var(--counter-shade),transparent_72%)]" />
        </div>
      </div>
      <section className="relative z-10 rounded-t-[2rem] bg-surface px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom)+var(--kb,0px))] pt-6 depth-3 md:rounded-[2rem] md:px-7 md:pb-[calc(1.75rem+var(--kb,0px))] md:pt-7">
        {children}
      </section>
    </div>
  );
}

function BackLink({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="t-label -ml-2 mb-3 inline-flex min-h-11 items-center gap-2 self-start rounded-md px-2 text-muted hover:bg-hover"
    >
      <ArrowLeft className="size-5" /> {children}
    </button>
  );
}

/**
 * The step's main button. On phones it rides above the keyboard (sticky to --kb, or to the
 * resized viewport where Chrome shrinks it), so the merchant never types blind to it.
 */
function Dock({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  // the backdrop only while pinned, over the fields it covers
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const check = () => {
      if (bar.current && end.current)
        setStuck(
          end.current.getBoundingClientRect().top - bar.current.getBoundingClientRect().bottom > 1,
        );
    };
    check();
    const vv = window.visualViewport;
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    vv?.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      vv?.removeEventListener('resize', check);
    };
  }, []);
  return (
    <>
      <div
        ref={bar}
        data-stuck={stuck || undefined}
        className="sticky bottom-[var(--kb,0px)] z-20 -mx-5 mt-2 px-5 py-2 data-stuck:bg-surface data-stuck:pb-3 data-stuck:before:pointer-events-none data-stuck:before:absolute data-stuck:before:inset-x-0 data-stuck:before:-top-4 data-stuck:before:h-4 data-stuck:before:bg-linear-to-t data-stuck:before:from-surface md:-mx-7 md:px-7 lg:static lg:mx-0 lg:mt-4 lg:p-0"
      >
        {children}
      </div>
      <div ref={end} aria-hidden />
    </>
  );
}

function PhoneStep({
  onSent,
  onEmail,
}: {
  onSent: (phone: string, expiresAt: string, devCode?: string) => void;
  onEmail: () => void;
}) {
  const [shown, setShown] = useState('');
  const [digits, setDigits] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: (p: string) => api.auth.start(p),
    onSuccess: (r, p) => onSent(p, r.expiresAt, r.devCode),
    onError: (e) => setErr(messageOf(e)),
  });
  return (
    <Counter
      pose="avatar-ola"
      title="Que bom te ver."
      lead="Entre com o celular da loja. O código chega no WhatsApp."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!digits) return setErr('Digite o celular com DDD, como (22) 99999-0000.');
          setErr(null);
          start.mutate(digits);
        }}
      >
        <Field label="Seu celular" htmlFor="phone" error={err}>
          <PhoneInput
            id="phone"
            autoFocus={finePointer()}
            value={shown}
            onChange={(v, d) => {
              setShown(v);
              setDigits(d);
            }}
          />
        </Field>
        <Dock>
          <Button
            type="submit"
            size="lg"
            block
            loading={start.isPending}
            icon={<WhatsappLogo weight="fill" />}
          >
            receber código
          </Button>
        </Dock>
      </form>
      <Button variant="ghost" block icon={<EnvelopeSimple />} onClick={onEmail}>
        entrar com e-mail
      </Button>
      <div className="mt-3 border-t border-line pt-2">
        <Link
          to="/comecar"
          className="-mx-2 flex min-h-14 items-center gap-3 rounded-md px-2 hover:bg-hover"
        >
          <span className="min-w-0 flex-1">
            <span className="t-caption block text-muted">Ainda não vende com a Venduá?</span>
            <span className="t-label block">Criar minha loja</span>
          </span>
          <CaretRight className="size-5 text-muted" aria-hidden />
        </Link>
      </div>
    </Counter>
  );
}

// A touch keyboard opened on arrival covers Duá and half the screen (after a tap from /comecar
// it would): focus the phone field only where there's a mouse or trackpad.
const finePointer = () => window.matchMedia('(pointer: fine)').matches;

const RESEND_AFTER = 30;

function useCountdown(from: number) {
  // counted from the send, not from this screen: a reload mustn't restart the wait
  const [wait, setWait] = useState(() =>
    Math.max(0, RESEND_AFTER - Math.floor((Date.now() - from) / 1000)),
  );
  useEffect(() => {
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return [wait, () => setWait(RESEND_AFTER)] as const;
}

function CodeStep({
  phone,
  sentAt,
  devCode,
  onBack,
  onResent,
  onSignedIn,
}: {
  phone: string;
  sentAt: number;
  devCode?: string | undefined;
  onBack: () => void;
  onResent: (expiresAt: string) => void;
  onSignedIn: (r: SignInResult) => void;
}) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [wait, restart] = useCountdown(sentAt);
  const input = useRef<CodeInputHandle>(null);
  const verify = useMutation({
    mutationFn: (c: string) => api.auth.verify(phone, c),
    onSuccess: onSignedIn,
    onError: (e) => {
      setErr(messageOf(e));
      setCode('');
      input.current?.focus();
    },
  });
  const resend = useMutation({
    mutationFn: () => api.auth.start(phone),
    onSuccess: (r) => {
      restart();
      onResent(r.expiresAt);
    },
  });
  return (
    <Counter
      pose="avatar-pensando"
      back={<BackLink onClick={onBack}>trocar número</BackLink>}
      title="Digite o código"
      lead={
        <>
          Enviamos 6 números para o WhatsApp{' '}
          <strong className="whitespace-nowrap text-ink">{fmtPhone(phone)}</strong>.
        </>
      }
    >
      {devCode ? (
        <p className="t-caption mb-4 rounded-sm bg-info-soft px-3 py-2 text-info">
          Ambiente de teste: o código é {devCode}
        </p>
      ) : null}
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
      <Dock>
        <Button
          size="lg"
          block
          loading={verify.isPending}
          disabled={code.length < 6}
          onClick={() => verify.mutate(code)}
          icon={<ArrowRight />}
        >
          entrar
        </Button>
      </Dock>
      <Button
        variant="ghost"
        block
        disabled={wait > 0}
        loading={resend.isPending}
        onClick={() => resend.mutate()}
      >
        {wait > 0 ? `reenviar código em ${wait}s` : 'reenviar código'}
      </Button>
    </Counter>
  );
}

function EmailStep({
  onBack,
  onSent,
}: {
  onBack: () => void;
  onSent: (email: string, devLink?: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: (e: string) => api.auth.emailStart(e),
    onSuccess: (r, e) => onSent(e, r.devLink),
    onError: (e) => setErr(messageOf(e)),
  });
  return (
    <Counter
      pose="avatar-ajuda"
      back={<BackLink onClick={onBack}>entrar com WhatsApp</BackLink>}
      title="Entrar com e-mail"
      lead="Use o e-mail cadastrado na loja. Mandamos um link que entra direto, sem senha."
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const v = email.trim();
          if (!EMAIL_RE.test(v)) return setErr('Confira o e-mail, como maria@gmail.com.');
          setErr(null);
          start.mutate(v);
        }}
      >
        <Field label="Seu e-mail" htmlFor="email" error={err}>
          <TextInput
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoFocus
            maxLength={200}
            placeholder="maria@gmail.com"
            value={email}
            aria-invalid={err ? true : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Dock>
          <Button type="submit" size="lg" block loading={start.isPending} icon={<EnvelopeSimple />}>
            mandar link
          </Button>
        </Dock>
      </form>
    </Counter>
  );
}

function EmailSentStep({
  email,
  sentAt,
  devLink,
  onOther,
  onWhatsapp,
}: {
  email: string;
  sentAt: number;
  devLink?: string | undefined;
  onOther: () => void;
  onWhatsapp: () => void;
}) {
  const [wait, restart] = useCountdown(sentAt);
  const [dev, setDev] = useState(devLink);
  const resend = useMutation({
    mutationFn: () => api.auth.emailStart(email),
    onSuccess: (r) => {
      restart();
      setDev(r.devLink);
    },
  });
  return (
    <Counter
      pose="avatar-feliz"
      back={<BackLink onClick={onOther}>usar outro e-mail</BackLink>}
      title="Olhe o seu e-mail"
    >
      <p className="t-body-lg" role="status">
        Se <strong className="break-all">{email}</strong> estiver cadastrado em uma loja, o link
        chega em instantes. Toque nele para entrar. Ele vale por 15 minutos.
      </p>
      {dev ? (
        <a
          href={dev}
          className="t-caption mt-3 block rounded-sm bg-info-soft px-3 py-2 text-info underline underline-offset-2"
        >
          Ambiente de teste: abrir o link
        </a>
      ) : null}
      <p className="t-body mt-4 text-muted">Não chegou? Confira a caixa de spam.</p>
      <Button
        variant="secondary"
        block
        className="mt-3"
        disabled={wait > 0}
        loading={resend.isPending}
        onClick={() => resend.mutate()}
      >
        {wait > 0 ? `mandar de novo em ${wait}s` : 'mandar de novo'}
      </Button>
      {resend.error ? (
        <p className="t-body mt-3 text-danger" role="alert">
          {messageOf(resend.error)}
        </p>
      ) : null}
      <Button
        variant="ghost"
        block
        className="mt-2"
        icon={<WhatsappLogo weight="fill" />}
        onClick={onWhatsapp}
      >
        entrar com WhatsApp
      </Button>
    </Counter>
  );
}

// A link works once: StrictMode's second effect (and a re-render) must reuse the first attempt.
const attempts = new Map<string, Promise<SignInResult>>();

function LinkStep({
  token,
  onSignedIn,
  onAgain,
  onWhatsapp,
}: {
  token: string;
  onSignedIn: (r: SignInResult) => void;
  onAgain: () => void;
  onWhatsapp: () => void;
}) {
  const [err, setErr] = useState<unknown>(null);
  const done = useRef(onSignedIn);
  done.current = onSignedIn;
  useEffect(() => {
    let live = true;
    let p = attempts.get(token);
    if (!p) attempts.set(token, (p = api.auth.emailVerify(token)));
    p.then(
      (r) => live && done.current(r),
      (e: unknown) => {
        attempts.delete(token);
        if (!live) return;
        setErr(e);
        // a refused link won't change; only a network failure is worth another tap on it
        if (!(e instanceof ApiError && e.status === 0))
          window.history.replaceState(null, '', '/admin/entrar');
      },
    );
    return () => {
      live = false;
    };
  }, [token]);
  if (!err)
    return (
      <Counter pose="avatar-feliz" title="Entrando…">
        <p className="t-body-lg inline-flex items-center gap-3" role="status">
          <Spinner className="size-5" /> Conferindo o link do seu e-mail.
        </p>
      </Counter>
    );
  const offline = err instanceof ApiError && err.status === 0;
  return (
    <Counter pose="avatar-ajuda" title={offline ? 'Sem conexão agora' : 'Esse link não vale mais'}>
      <p className="t-body-lg" role="alert">
        {offline
          ? 'Confira a internet e toque no link do e-mail de novo.'
          : 'Ele já foi usado ou passou dos 15 minutos. Peça outro, leva um instante.'}
      </p>
      <Button size="lg" block className="mt-5" icon={<EnvelopeSimple />} onClick={onAgain}>
        mandar outro link
      </Button>
      <Button
        variant="ghost"
        block
        className="mt-2"
        icon={<WhatsappLogo weight="fill" />}
        onClick={onWhatsapp}
      >
        entrar com WhatsApp
      </Button>
    </Counter>
  );
}

function PickStep({
  token,
  stores,
  onDone,
}: {
  token: string;
  stores: StoreRef[];
  onDone: () => void;
}) {
  const pick = useMutation({
    mutationFn: (id: string) => api.auth.select(token, id),
    onSuccess: onDone,
  });
  return (
    <Counter
      pose="avatar-pensando"
      title="Qual loja agora?"
      lead={`Você faz parte de ${stores.length} lojas. Dá para trocar depois.`}
    >
      <ul className="-mx-2 space-y-1">
        {stores.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={pick.isPending}
              onClick={() => pick.mutate(s.id)}
              className="flex min-h-16 w-full items-center gap-4 rounded-lg px-2 text-left hover:bg-hover"
            >
              <span className="grid size-11 place-items-center rounded-full bg-sunken">
                <Storefront weight="duotone" className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="t-caption text-muted">{ROLE_LABEL[s.role]}</span>
              </span>
              <CaretRight className="size-5 text-muted" />
            </button>
          </li>
        ))}
      </ul>
      {pick.error ? (
        <p className="t-body mt-3 text-danger">
          {pick.error instanceof ApiError && pick.error.status === 401
            ? 'Passou tempo demais. Entre de novo.'
            : messageOf(pick.error)}
        </p>
      ) : null}
    </Counter>
  );
}
