import {
  ArrowLeft,
  ArrowRight,
  ClipboardText,
  Storefront,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type StoreRef } from '../../lib/api.ts';
import { phone as fmtPhone } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { ROLE_LABEL } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { messageOf } from '../../ui/feedback.tsx';
import { Field, PhoneInput } from '../../ui/fields.tsx';
import { ArtStore } from '../../ui/illustrations.tsx';

type Step =
  | { kind: 'phone' }
  | { kind: 'code'; phone: string; sentAt: number; devCode?: string }
  | { kind: 'pick'; token: string; stores: StoreRef[] };

// The code arrives in WhatsApp, so the merchant leaves the app to read it, and the
// phone may kill the app meanwhile (iOS does, often). The pending step is kept until
// the code expires, so coming back lands on "Digite o código". Never the code itself.
const PENDING = 'vendua-admin-signin';
type Pending = { phone: string; sentAt: number; expiresAt: number };

function loadPending(): Step {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) ?? 'null') as Pending | null;
    if (p && typeof p.phone === 'string' && p.expiresAt > Date.now())
      return { kind: 'code', phone: p.phone, sentAt: p.sentAt };
  } catch {
    /* private mode or a bad value: start over */
  }
  return { kind: 'phone' };
}
function savePending(p: Pending | null) {
  try {
    if (p) localStorage.setItem(PENDING, JSON.stringify(p));
    else localStorage.removeItem(PENDING);
  } catch {
    /* private mode: the step lives in memory only */
  }
}
const expiry = (iso: string) => Date.parse(iso) || Date.now() + 10 * 60_000;

/** Sign in with the phone: a 6-digit code on WhatsApp, no password (ADR 0020). */
export function Login() {
  const [step, setStep] = useState<Step>(loadPending);
  const qc = useQueryClient();
  const enter = () => {
    savePending(null);
    void qc.invalidateQueries({ queryKey: qk.session });
    window.history.replaceState(null, '', '/admin/');
  };
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
            <div className="mb-6 w-56 text-spark [&_svg]:w-full">
              <ArtStore />
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
              onPick={(token, stores) => {
                savePending(null);
                setStep({ kind: 'pick', token, stores });
              }}
              onDone={enter}
            />
          ) : (
            <PickStep token={step.token} stores={step.stores} onDone={enter} />
          )}
        </div>
      </main>
    </div>
  );
}

function PhoneStep({
  onSent,
}: {
  onSent: (phone: string, expiresAt: string, devCode?: string) => void;
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
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!digits) return setErr('Digite o celular com DDD, como (22) 99999-0000.');
        setErr(null);
        start.mutate(digits);
      }}
      className="animate-fade-up"
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
  );
}

const RESEND_AFTER = 30;

function CodeStep({
  phone,
  sentAt,
  devCode,
  onBack,
  onResent,
  onPick,
  onDone,
}: {
  phone: string;
  sentAt: number;
  devCode?: string | undefined;
  onBack: () => void;
  onResent: (expiresAt: string) => void;
  onPick: (token: string, stores: StoreRef[]) => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // counted from the send, not from this screen: a reload mustn't restart the wait
  const [wait, setWait] = useState(() =>
    Math.max(0, RESEND_AFTER - Math.floor((Date.now() - sentAt) / 1000)),
  );
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const verify = useMutation({
    mutationFn: (c: string) => api.auth.verify(phone, c),
    onSuccess: (r) => (r.signedIn ? onDone() : onPick(r.pickerToken, r.stores)),
    onError: (e) => {
      setErr(messageOf(e));
      setCode('');
      inputs.current[0]?.focus();
    },
  });
  const resend = useMutation({
    mutationFn: () => api.auth.start(phone),
    onSuccess: (r) => {
      setWait(RESEND_AFTER);
      onResent(r.expiresAt);
    },
  });
  const setAt = (i: number, v: string) => {
    const d = v.replace(/\D/g, '');
    if (d.length > 1) {
      // pasted or autofilled the whole code
      const full = d.slice(0, 6);
      setCode(full);
      if (full.length === 6) verify.mutate(full);
      else inputs.current[full.length]?.focus();
      return;
    }
    const next = (code.slice(0, i) + d + code.slice(i + 1)).slice(0, 6);
    setCode(next);
    if (d && i < 5) inputs.current[i + 1]?.focus();
    if (next.length === 6 && /^\d{6}$/.test(next)) verify.mutate(next);
  };
  return (
    <div className="animate-fade-up">
      <button
        type="button"
        onClick={onBack}
        className="t-label -ml-2 mb-6 inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-muted hover:bg-hover"
      >
        <ArrowLeft className="size-5" /> trocar número
      </button>
      <h1 className="t-title-1">Digite o código</h1>
      <p className="t-body-lg mt-2 text-muted">
        Enviamos 6 números para o WhatsApp <strong className="text-ink">{fmtPhone(phone)}</strong>.
      </p>
      {devCode ? (
        <p className="t-caption mt-3 rounded-sm bg-info-soft px-3 py-2 text-info">
          Ambiente de teste: o código é {devCode}
        </p>
      ) : null}
      <fieldset className="mt-8">
        <legend className="sr-only">código de 6 números</legend>
        <div className="flex justify-between gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <input
              key={i}
              ref={(el) => (inputs.current[i] = el)}
              aria-label={`número ${i + 1}`}
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              autoFocus={i === 0}
              maxLength={i === 0 ? 6 : 1}
              value={code[i] ?? ''}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !code[i] && i > 0) inputs.current[i - 1]?.focus();
              }}
              aria-invalid={err ? true : undefined}
              className={cn(
                'tnum h-16 w-full min-w-0 rounded-md bg-sunken text-center font-display text-3xl font-semibold ring-1 ring-transparent',
                'focus:bg-surface focus:ring-2 focus:ring-primary focus:outline-none aria-invalid:ring-danger',
              )}
            />
          ))}
        </div>
      </fieldset>
      {canPaste && code.length < 6 ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          icon={<ClipboardText />}
          onClick={async () => {
            // WhatsApp's code message has a "copiar código" button
            const d = (await navigator.clipboard.readText().catch(() => '')).replace(/\D/g, '');
            if (d.length === 6) setAt(0, d);
            else setErr('Não achamos um código de 6 números copiado. Digite o código.');
          }}
        >
          colar código
        </Button>
      ) : null}
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
            ? 'O código venceu. Entre de novo.'
            : messageOf(pick.error)}
        </p>
      ) : null}
    </div>
  );
}
