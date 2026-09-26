import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, type IgStatus, type IgStep } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Input, Textarea } from '@/components/ui/input.tsx';
import { ConfirmButton } from '@/components/common.tsx';

const dark =
  'border-sidebar-border bg-sidebar-accent text-sidebar-foreground placeholder:text-sidebar-muted';
const quiet = 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground';
const foot = 'text-xs text-sidebar-muted';

// errors the sidecar can't fix with a login — nothing to type, only ops can help
const UNREACHABLE = new Set(['sidecar_unreachable', 'no_secret', 'sidecar_error']);

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
  const [step, setStep] = useState<IgStep | null>(null);
  const [mode, setMode] = useState<'password' | 'cookies'>('password');
  const [values, setValues] = useState<Record<string, string>>({});
  const [cookies, setCookies] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setStep(null);
    setErr(null);
    setValues({});
  }, [resetSignal]);

  // a login the sidecar still holds (page reload mid-2FA) picks up where it was
  const shown = step ?? ig?.login ?? null;

  const done = (s: IgStep) => {
    if (s.type === 'complete') {
      toast.success(s.instructions || 'instagram conectado');
      setStep(null);
      setCookies('');
    } else {
      setStep(s);
    }
    setValues({});
    void qc.invalidateQueries({ queryKey: qk.integrations() });
  };

  const run = async (fn: () => Promise<{ step: IgStep }>) => {
    setBusy(true);
    setErr(null);
    try {
      done((await fn()).step);
    } catch (e) {
      setErr(errorMessage(e));
      // the sidecar dropped the login (expired/terminal) — back to the start button
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setStep(null);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setStep(null);
    setErr(null);
    setValues({});
    await api.igLoginCancel().catch(() => undefined);
    void qc.invalidateQueries({ queryKey: qk.integrations() });
  };

  const submit = (e: FormEvent, input: Record<string, string> = values) => {
    e.preventDefault();
    void run(() => api.igLoginSubmit(input));
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

      {shown ? (
        <StepForm
          step={shown}
          values={values}
          setValues={setValues}
          busy={busy}
          onSubmit={submit}
          onCancel={() => void cancel()}
        />
      ) : mode === 'password' ? (
        <>
          <div className="text-sm font-medium">entrar na conta do instagram da venduá</div>
          <p className={foot}>
            o login roda no sidecar, pelo mesmo IP que vai enviar as DMs — o instagram pode pedir
            código de 2 fatores ou aprovação no app.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="agent"
              disabled={busy}
              onClick={() => void run(() => api.igLoginStart())}
            >
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
              entrar com usuário e senha
            </Button>
            <Button variant="ghost" className={quiet} onClick={() => setMode('cookies')}>
              <ClipboardPaste /> colar cookies
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.igLoginCookies(cookies));
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
            <Button variant="ghost" className={quiet} onClick={() => setMode('password')}>
              voltar
            </Button>
          </div>
          <p className={foot}>
            depois de colar, saia só fechando a janela anônima — "sair da conta" invalida a sessão.
          </p>
        </form>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}
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
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => onSubmit(e)}>
      <p className="text-sm">{step.instructions}</p>
      {step.type === 'input' && select ? (
        <div className="flex flex-wrap gap-2">
          {(select.options ?? []).map((o) => (
            <Button
              key={o}
              variant="agent"
              disabled={busy}
              onClick={(e) => onSubmit(e, { [select.id]: o })}
            >
              {o}
            </Button>
          ))}
        </div>
      ) : (
        <>
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
              {step.type === 'wait' ? 'já aprovei' : busy ? 'enviando…' : 'continuar'}
            </Button>
            <Button variant="ghost" className={quiet} disabled={busy} onClick={onCancel}>
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
