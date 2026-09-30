import {
  ArrowLeft,
  ArrowRight,
  EnvelopeSimple,
  Storefront,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
import { Mascote } from '../../ui/Mascote.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
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
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-primary text-on-primary lg:block">
        <div
          aria-hidden
          className="animate-breathe absolute -left-24 top-1/3 size-[520px] rounded-full bg-spark blur-3xl"
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <p className="font-display text-2xl font-semibold tracking-tight">venduá</p>
          <div className="max-w-md">
            <div className="mb-6 w-56 rounded-xl bg-[#f7f4ea] p-4">
              <Mascote pose="avatar-ola" size={224} />
            </div>
            <p className="t-moment text-[2.75rem] leading-[3rem]">A loja viva na palma da mão.</p>
            <p className="t-body-lg mt-4 opacity-80">
              Pedidos chegando na hora, cardápio com foto, horário e entrega do seu jeito, e o dia
              de vendas crescendo na sua frente.
            </p>
          </div>
          <p className="t-caption opacity-60">
            Precisa de ajuda para entrar? Fale com a Venduá no WhatsApp.
          </p>
        </div>
      </aside>
      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <p className="mb-8 font-display text-2xl font-semibold tracking-tight lg:hidden">
            venduá
          </p>
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
      </main>
    </div>
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
    <div className="animate-fade-up">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!digits) return setErr('Digite o celular com DDD, como (22) 99999-0000.');
          setErr(null);
          start.mutate(digits);
        }}
      >
        <h1 className="t-moment">Que bom te ver.</h1>
        <p className="t-body-lg mt-2 text-muted">
          Entre com o celular da loja. Mandamos um código no seu WhatsApp.
        </p>
        <Field label="Seu celular" htmlFor="phone" error={err} className="mt-8">
          <PhoneInput
            id="phone"
            autoFocus
            value={shown}
            onChange={(v, d) => {
              setShown(v);
              setDigits(d);
            }}
          />
        </Field>
        <Button
          type="submit"
          size="lg"
          block
          className="mt-6"
          loading={start.isPending}
          icon={<WhatsappLogo weight="fill" />}
        >
          receber código
        </Button>
      </form>
      <Button variant="ghost" block className="mt-2" icon={<EnvelopeSimple />} onClick={onEmail}>
        entrar com e-mail
      </Button>
      <div className="mt-10 flex items-center gap-4 rounded-lg bg-sunken p-4">
        <Storefront weight="duotone" className="size-8 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Ainda não vende com a Venduá?</p>
          <Link
            to="/comecar"
            className="t-label -ml-1 mt-0.5 inline-flex min-h-11 items-center gap-1 rounded-sm px-1 underline underline-offset-2 hover:bg-hover"
          >
            criar minha loja <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

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

function BackLink({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="t-label -ml-2 mb-6 inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-muted hover:bg-hover"
    >
      <ArrowLeft className="size-5" /> {children}
    </button>
  );
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
    <div className="animate-fade-up">
      <BackLink onClick={onBack}>trocar número</BackLink>
      <div className="flex items-center justify-between gap-3">
        <h1 className="t-title-1">Digite o código</h1>
        <Mascote pose="seguranca" size={72} className="size-16 shrink-0 sm:size-[72px]" />
      </div>
      <p className="t-body-lg mt-2 text-muted">
        Enviamos 6 números para o WhatsApp{' '}
        <strong className="whitespace-nowrap text-ink">{fmtPhone(phone)}</strong>.
      </p>
      {devCode ? (
        <p className="t-caption mt-3 rounded-sm bg-info-soft px-3 py-2 text-info">
          Ambiente de teste: o código é {devCode}
        </p>
      ) : null}
      <div className="mt-8">
        <CodeInput
          ref={input}
          value={code}
          onChange={setCode}
          onComplete={(c) => verify.mutate(c)}
          invalid={!!err}
          onPasteMiss={() => setErr('Não achamos um código de 6 números copiado. Digite o código.')}
        />
      </div>
      {err ? (
        <p className="t-body mt-3 text-danger" role="alert">
          {err}
        </p>
      ) : null}
      <Button
        size="lg"
        block
        className="mt-6"
        loading={verify.isPending}
        disabled={code.length < 6}
        onClick={() => verify.mutate(code)}
        icon={<ArrowRight />}
      >
        entrar
      </Button>
      <Button
        variant="ghost"
        block
        className="mt-2"
        disabled={wait > 0}
        loading={resend.isPending}
        onClick={() => resend.mutate()}
      >
        {wait > 0 ? `reenviar código em ${wait}s` : 'reenviar código'}
      </Button>
    </div>
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
    <form
      className="animate-fade-up"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const v = email.trim();
        if (!EMAIL_RE.test(v)) return setErr('Confira o e-mail, como maria@gmail.com.');
        setErr(null);
        start.mutate(v);
      }}
    >
      <BackLink onClick={onBack}>entrar com WhatsApp</BackLink>
      <h1 className="t-title-1">Entrar com e-mail</h1>
      <p className="t-body-lg mt-2 text-muted">
        Use o e-mail cadastrado na loja. Mandamos um link que entra direto, sem senha.
      </p>
      <Field label="Seu e-mail" htmlFor="email" error={err} className="mt-8">
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
      <Button
        type="submit"
        size="lg"
        block
        className="mt-6"
        loading={start.isPending}
        icon={<EnvelopeSimple />}
      >
        mandar link
      </Button>
    </form>
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
    <div className="animate-fade-up">
      <BackLink onClick={onOther}>usar outro e-mail</BackLink>
      <div className="flex items-center justify-between gap-3">
        <h1 className="t-title-1">Olhe o seu e-mail</h1>
        <Mascote pose="avatar-feliz" size={72} className="size-16 shrink-0 sm:size-[72px]" />
      </div>
      <p className="t-body-lg mt-2 text-muted" role="status">
        Se <strong className="break-all text-ink">{email}</strong> estiver cadastrado em uma loja, o
        link chega em instantes. Toque nele para entrar. Ele vale por 15 minutos.
      </p>
      {dev ? (
        <a
          href={dev}
          className="t-caption mt-3 block rounded-sm bg-info-soft px-3 py-2 text-info underline underline-offset-2"
        >
          Ambiente de teste: abrir o link
        </a>
      ) : null}
      <p className="t-body mt-6 text-muted">Não chegou? Confira a caixa de spam.</p>
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
    </div>
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
      <div className="animate-fade-up flex flex-col items-center py-10 text-center" role="status">
        <span className="dua-disc grid size-36 place-items-center">
          <Mascote pose="carregando" size={128} className="w-32" />
        </span>
        <p className="t-title-2 mt-4 inline-flex items-center gap-2">
          <Spinner className="size-5" /> Entrando…
        </p>
        <p className="t-body mt-1 text-muted">Conferindo o link do seu e-mail.</p>
      </div>
    );
  const offline = err instanceof ApiError && err.status === 0;
  return (
    <div className="animate-fade-up">
      <Mascote pose={offline ? 'offline' : 'seguranca'} size={120} className="w-28" />
      <h1 className="t-title-1 mt-4">
        {offline ? 'Sem conexão agora' : 'Esse link não vale mais'}
      </h1>
      <p className="t-body-lg mt-2 text-muted" role="alert">
        {offline
          ? 'Confira a internet e toque no link do e-mail de novo.'
          : 'Ele já foi usado ou passou dos 15 minutos. Peça outro, leva um instante.'}
      </p>
      <Button size="lg" block className="mt-8" icon={<EnvelopeSimple />} onClick={onAgain}>
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
    </div>
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
    <div className="animate-fade-up">
      <h1 className="t-title-1">Qual loja agora?</h1>
      <p className="t-body-lg mt-2 text-muted">
        Você faz parte de {stores.length} lojas. Dá para trocar depois.
      </p>
      <ul className="mt-6 space-y-2">
        {stores.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={pick.isPending}
              onClick={() => pick.mutate(s.id)}
              className="flex min-h-18 w-full items-center gap-4 rounded-lg bg-surface px-4 text-left depth-1 hover:bg-hover"
            >
              <span className="grid size-11 place-items-center rounded-full bg-sunken">
                <Storefront weight="duotone" className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="t-caption text-muted">{ROLE_LABEL[s.role]}</span>
              </span>
              <ArrowRight className="size-5 text-muted" />
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
    </div>
  );
}
