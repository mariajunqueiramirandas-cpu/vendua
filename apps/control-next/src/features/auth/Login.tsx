import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api.ts';
import { Button } from '@/components/ui/button.tsx';

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.login(key);
      onLogin();
    } catch {
      setErr('chave incorreta');
      setKey('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dark flex h-full items-center justify-center bg-[radial-gradient(120%_90%_at_50%_-10%,#0c1410,#0a100d_70%)] px-4 max-md:h-vv max-md:pt-safe">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3">
        <div className="mb-4 text-center font-serif text-5xl text-foreground italic">
          venduá
          <span className="ml-2 align-middle font-mono text-xs tracking-[0.14em] text-agent not-italic uppercase">
            controle
          </span>
        </div>
        <input
          type="password"
          placeholder="chave de acesso"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="current-password"
          autoFocus
          className="h-11 rounded-lg border border-input bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
        <p className="h-4 text-center text-xs text-destructive-foreground" role="alert">
          {err}
        </p>
        <Button variant="agent" size="lg" type="submit" disabled={busy || !key}>
          entrar
        </Button>
      </form>
    </div>
  );
}
