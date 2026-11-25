import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, Globe, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, type IgStatus, type IgStep } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Input, Textarea } from '@/components/ui/input.tsx';
import { ConfirmButton } from '@/components/common.tsx';
import { InstagramCaptcha } from './InstagramCaptcha.tsx';

const dark =
  'border-sidebar-border bg-sidebar-accent text-sidebar-foreground placeholder:text-sidebar-muted';
const quiet = 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground';
const foot = 'text-xs text-sidebar-muted';

const CAPTCHA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

// errors the sidecar can't fix with a login — nothing to type, only ops can help
const UNREACHABLE = new Set(['sidecar_unreachable', 'no_secret', 'sidecar_error']);
const VERIFY_ON_INSTAGRAM = new Set([
  'IG_CAPTCHA',
  'IG_CHECKPOINT_UNSUPPORTED',
  'IG_UNSUPPORTED_STEP',
  'IG_CHALLENGE',
  'IG_CHECKPOINT',
]);

type LoginAction =
  | { type: 'start'; web?: boolean }
  | { type: 'cancel' | 'cookies' }
  | { type: 'submit'; input?: Record<string, string> | undefined };

/**
 * Login + status panel for an active sidecar driver. The sidecar walks Instagram's
 * own steps (password → 2FA → approvals); this renders whatever step comes back.
 * `resetSignal` bumps when the saved row changes — a half-done wizard belongs to it.
 */
export function InstagramConnect({
  ig,
  resetSignal,
  onLogout,
  loggingOut,
}: {
  ig: IgStatus | null;
  resetSignal: number;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'password' | 'cookies'>('password');
  // which login the last start used: the Android app's (default) or the website's
  const [flow, setFlow] = useState<'app' | 'web'>('app');
  const [values, setValues] = useState<Record<string, string>>({});
  const [cookies, setCookies] = useState('');

  const setLogin = async (login: IgStep | null) => {
    await qc.cancelQueries({ queryKey: qk.igStatus(), exact: true });
    qc.setQueryData<IgStatus>(qk.igStatus(), (status) => ({
      ...status,
      state: status?.state ?? 'off',
      login,
    }));
    setValues({});
  };

  const {
    mutate,
    reset,
    isPending: busy,
    variables,
    error,
  } = useMutation({
    mutationFn: async (action: LoginAction) => {
      switch (action.type) {
        case 'start':
          return (await api.igLoginStart(action.web ? 'web' : undefined)).step;
        case 'submit':
          return (await api.igLoginSubmit(action.input ?? values)).step;
        case 'cookies':
          return (await api.igLoginCookies(cookies)).step;
        case 'cancel':
          await api.igLoginCancel();
          return null;
      }
    },
    onSuccess: async (step) => {
      if (step?.type === 'complete') {
        toast.success(step.instructions || 'instagram conectado');
        setCookies('');
      }
      await setLogin(step?.type === 'complete' ? null : step);
    },
    onError: () => setLogin(null),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.integrations() });
    },
  });

  useEffect(() => {
    reset();
    setValues({});
    setCookies('');
    setMode('password');
    setFlow('app');
  }, [reset, resetSignal]);

  const cancelling = busy && variables?.type === 'cancel';
  // an app login that failed can be retried as the website's (its reCAPTCHA needs a computer)
  const appFailed =
    !!error && flow === 'app' && (variables?.type === 'start' || variables?.type === 'submit');
  const start = (web: boolean) => {
    setFlow(web ? 'web' : 'app');
    mutate({ type: 'start', web });
  };
  const shown = ig?.login ?? null;
  const captcha = shown?.type === 'captcha' ? shown.captcha : undefined;

  const cancel = () => {
    setValues({});
    setCookies('');
    setMode('password');
    mutate({ type: 'cancel' });
  };

  const submit = (e: FormEvent, input?: Record<string, string>) => {
    e.preventDefault();
    if (!busy) mutate({ type: 'submit', input });
  };

  if (ig?.state === 'open') {
    return (
      <Panel>
        <div className="text-[11px] font-medium tracking-wide text-agent uppercase">conectado</div>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate text-base font-medium">@{ig.account?.username ?? '—'}</span>
          {ig.account?.name && (
            <span className="truncate text-sm text-sidebar-muted">{ig.account.name}</span>
          )}
        </div>
        <p className={foot}>
          o agente já manda e recebe DMs por essa conta — DM frio respeita o teto diário em estúdio
          → limites.
        </p>
        <div>
          <ConfirmButton
            size="sm"
            variant="destructive-outline"
            confirm="desconectar mesmo?"
            disabled={loggingOut}
            onConfirm={onLogout}
          >
            desconectar conta
          </ConfirmButton>
        </div>
      </Panel>
    );
  }

  if (ig?.state === 'connecting') {
    return (
      <Panel>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin" /> conectando ao instagram…
        </div>
        {ig.error?.message && <p className={foot}>última falha: {ig.error.message}</p>}
        <div>
          <ConfirmButton
            size="sm"
            variant="destructive-outline"
            confirm="apagar a sessão?"
            disabled={loggingOut}
            onConfirm={onLogout}
          >
            desconectar
          </ConfirmButton>
        </div>
      </Panel>
    );
  }

  if (ig?.error && UNREACHABLE.has(ig.error.code)) {
    return (
      <Panel>
        <div className="text-[11px] font-medium tracking-wide text-warning uppercase">
          sidecar indisponível
        </div>
        <p className="text-sm">{ig.error.message}</p>
        <p className={foot}>
          confira o serviço ig-sidecar e a env IG_SIDECAR_SECRET nos dois lados — esta tela atualiza
          sozinha em até um minuto.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      {ig?.state === 'error' && ig.error && !shown && (
        <p className="rounded-md bg-sidebar-accent px-2.5 py-1.5 text-xs text-warning">
          {ig.error.message}
        </p>
      )}

      {cancelling ? (
        <p role="status" className="text-sm">
          cancelando login…
        </p>
      ) : shown && captcha ? (
        <InstagramCaptcha
          key={captcha.instance}
          captcha={captcha}
          instructions={shown.instructions}
          busy={busy}
          onSubmit={(token) =>
            mutate({
              type: 'submit',
              input: { captcha_token: token, captcha_instance: captcha.instance },
            })
          }
          onCancel={cancel}
        />
      ) : shown ? (
        <StepForm
          step={shown}
          values={values}
          setValues={setValues}
          busy={busy}
          onSubmit={submit}
          onCancel={cancel}
        />
      ) : mode === 'password' ? (
        <>
          <div className="text-sm font-medium">entrar na conta do instagram da venduá</div>
          <p className={foot}>
            entra como o app do instagram: código, aprovação no app e captcha de letras dá para
            resolver daqui, no celular também.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="agent" disabled={busy} onClick={() => start(false)}>
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
              entrar com usuário e senha
            </Button>
            {appFailed && (
              <Button variant="ghost" className={quiet} disabled={busy} onClick={() => start(true)}>
                <Globe /> entrar pelo site
              </Button>
            )}
            <Button
              variant="ghost"
              className={quiet}
              disabled={busy}
              onClick={() => setMode('cookies')}
            >
              <ClipboardPaste /> colar cookies
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && cookies.trim()) mutate({ type: 'cookies' });
          }}
        >
          <div className="text-sm font-medium">entrar com cookies do navegador</div>
          <ol className={`${foot} list-decimal space-y-0.5 pl-4`}>
            <li>abra instagram.com numa janela anônima e entre na conta</li>
            <li>devtools (F12) → rede → recarregue a página</li>
            <li>clique direito numa requisição a instagram.com → copiar como cURL</li>
            <li>cole aqui (JSON de cookies também serve)</li>
          </ol>
          <Textarea
            aria-label="cookies ou comando cURL"
            rows={4}
            spellCheck={false}
            autoComplete="off"
            className={`font-mono text-xs ${dark}`}
            placeholder="curl 'https://www.instagram.com/…' -H 'cookie: sessionid=…'"
            value={cookies}
            onChange={(e) => setCookies(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="agent" disabled={busy || !cookies.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              {busy ? 'validando…' : 'conectar'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={quiet}
              disabled={busy}
              onClick={() => setMode('password')}
            >
              voltar
            </Button>
          </div>
          <p className={foot}>
            depois de colar, saia só fechando a janela anônima — "sair da conta" invalida a sessão.
          </p>
        </form>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage(error)}
        </p>
      )}
      {error instanceof ApiError && VERIFY_ON_INSTAGRAM.has(error.code) && (
        <div>
          <Button asChild variant="agent">
            <a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer">
              abrir Instagram
            </a>
          </Button>
        </div>
      )}
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex min-w-0 flex-col gap-2.5 rounded-lg bg-sidebar p-3 text-sidebar-foreground">
      {children}
    </div>
  );
}

function StepForm({
  step,
  values,
  setValues,
  busy,
  onSubmit,
  onCancel,
}: {
  step: IgStep;
  values: Record<string, string>;
  setValues: (v: Record<string, string>) => void;
  busy: boolean;
  onSubmit: (e: FormEvent, input?: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const fields = step.fields ?? [];
  const select = fields.find((f) => f.type === 'select');
  const choices = select?.options?.filter(
    (option) => select.id !== 'cookie_consent' || option !== 'Cancelar login',
  );
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => onSubmit(e)}>
      <p className="text-sm">{step.instructions}</p>
      {step.type === 'input' && select ? (
        <div className="flex flex-wrap gap-2">
          {choices?.map((option) => (
            <Button
              key={option}
              type="button"
              variant="agent"
              disabled={busy}
              className="h-auto min-h-8 whitespace-normal py-1.5"
              onClick={(e) => onSubmit(e, { [select.id]: option })}
            >
              {option}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            className={quiet}
            disabled={busy}
            onClick={onCancel}
          >
            cancelar
          </Button>
        </div>
      ) : (
        <>
          {step.image && CAPTCHA_IMAGE.test(step.image) && (
            <img
              src={step.image}
              alt="captcha do instagram: letras e números para digitar"
              className="max-h-24 w-auto max-w-full self-start rounded-md bg-white p-1"
            />
          )}
          {step.code && (
            <div className="flex items-baseline gap-2.5">
              <span className={foot}>número</span>
              <span className="font-mono text-3xl font-semibold tracking-[0.2em] tabular-nums">
                {step.code}
              </span>
            </div>
          )}
          {fields.map((f) => (
            <label key={f.id} className="flex flex-col gap-1">
              <span className="text-xs text-sidebar-muted">{f.name}</span>
              <Input
                name={f.id}
                className={dark}
                spellCheck={false}
                autoCapitalize="none"
                {...inputProps(f.type)}
                value={values[f.id] ?? ''}
                onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="agent" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {step.type === 'wait'
                ? busy
                  ? 'esperando a aprovação…'
                  : 'já aprovei'
                : busy
                  ? 'enviando…'
                  : 'continuar'}
            </Button>
            {step.type === 'wait' && step.back && (
              <Button
                type="button"
                variant="ghost"
                className={quiet}
                disabled={busy}
                onClick={(e) => onSubmit(e, { back: 'true' })}
              >
                usar outro método
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className={quiet}
              disabled={busy}
              onClick={onCancel}
            >
              cancelar
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

function inputProps(type: string) {
  switch (type) {
    case 'password':
      return { type: 'password', autoComplete: 'current-password' } as const;
    case 'username':
      return { autoComplete: 'username' } as const;
    case '2fa_code':
      return { inputMode: 'numeric', autoComplete: 'one-time-code' } as const;
    default:
      return { autoComplete: 'off' } as const;
  }
}
