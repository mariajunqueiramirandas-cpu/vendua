import { useState } from 'react';
import { api } from '../api.ts';

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
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
    <div className="login">
      <form onSubmit={submit}>
        <div className="mark">
          venduá <em>controle</em>
        </div>
        <input
          type="password"
          placeholder="chave de acesso"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
        />
        <div className="err">{err}</div>
        <button className="btn agent" disabled={busy || !key} type="submit">
          entrar
        </button>
      </form>
    </div>
  );
}
