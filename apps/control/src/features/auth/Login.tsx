import { useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { BrandMark } from '@/app/AppShell.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';

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
      setErr('Chave incorreta.');
      setKey('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-app px-4 max-md:h-vv max-md:pt-safe">
      <form
        onSubmit={submit}
        className="flex w-full max-w-[340px] flex-col rounded-2xl bg-background p-7 shadow-pop"
      >
        <BrandMark className="size-9 rounded-[10px] text-[24px]" />
        <h1 className="mt-5 text-lg font-semibold tracking-[-0.02em]">Entrar no venduá</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Use a chave de acesso da equipe para abrir o console.
        </p>
        <Input
          type="password"
          placeholder="chave de acesso"
          aria-label="chave de acesso"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="current-password"
          autoFocus
          className="mt-5 h-10 md:h-9"
        />
        <p className="mt-1.5 min-h-4 text-xs text-destructive-foreground" role="alert">
          {err}
        </p>
        <Button type="submit" size="lg" className="mt-2 md:h-9" disabled={busy || !key}>
          entrar <ArrowRight />
        </Button>
      </form>
    </div>
  );
}
