import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { errorMessage } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ErrorHint } from './bits.tsx';

const WORD = 'resetar';
const SLOW_MS = 3 * 60_000;

/**
 * Wipes a test instance (only rendered when Core runs with VENDUA_ALLOW_RESET=1). Core restarts
 * and its entrypoint rebuilds the database, so this session ends with it: once the gate stops
 * knowing our cookie, the page reloads into the login.
 */
export function ResetPanel() {
  const [typed, setTyped] = useState('');
  const [slow, setSlow] = useState(false);
  const reset = useMutation({ mutationFn: () => api.resetInstance(typed) });
  const ok = typed.trim().toLowerCase() === WORD;

  useEffect(() => {
    if (!reset.isSuccess) return;
    const started = Date.now();
    // a 200 is the old Core still draining, a 502 the restart; the 404 is the new database
    const t = setInterval(() => {
      if (Date.now() - started > SLOW_MS) setSlow(true);
      void fetch('/control/v1/instance', {
        credentials: 'same-origin',
        headers: { 'x-vendua-staff': '1' },
      })
        .then((r) => r.status === 404 && window.location.reload())
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [reset.isSuccess]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok && !reset.isPending) reset.mutate();
  };

  return (
    <Panel
      title="instância de teste"
      aside="VENDUA_ALLOW_RESET=1"
      className="border-destructive/30"
    >
      {reset.isSuccess ? (
        <div className="flex flex-col gap-1" role="status">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin" /> apagando e recriando o banco…
          </div>
          <p className="text-xs text-muted-foreground">
            o Core reinicia, migra e semeia de novo. a página volta sozinha para o login — entre com
            a chave de sempre.
          </p>
          {slow && (
            <ErrorHint>está demorando: confira os logs do serviço core no Dokploy.</ErrorHint>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            apaga tudo desta instância — lojas, pedidos, leads, conversas, sessões e conexões — e o
            Core volta com o banco vazio. não tem desfazer.
          </p>
          <Field label={`digite "${WORD}" para confirmar`} htmlFor="reset-confirm">
            <Input
              id="reset-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={WORD}
              disabled={reset.isPending}
              className="max-w-60"
            />
          </Field>
          {reset.isError && <ErrorHint>{errorMessage(reset.error)}</ErrorHint>}
          <div>
            <Button type="submit" variant="destructive" disabled={!ok || reset.isPending}>
              {reset.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              resetar instância
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
