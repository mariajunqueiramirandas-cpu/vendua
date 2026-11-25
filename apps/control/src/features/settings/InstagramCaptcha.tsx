import { useState, type FormEvent } from 'react';
import { Copy, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/input.tsx';
import type { IgCaptcha } from '@/lib/api.ts';

const META_ORIGIN = 'https://www.fbsbx.com';
const TOKEN_MAX = 16_384;

const dark =
  'border-sidebar-border bg-sidebar-accent text-sidebar-foreground placeholder:text-sidebar-muted';
const quiet = 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground';
const foot = 'text-xs text-sidebar-muted';

function frameURL(raw: string) {
  try {
    const url = new URL(raw);
    if (
      url.origin === META_ORIGIN &&
      url.pathname === '/captcha/recaptcha/iframe/' &&
      !url.username &&
      !url.password &&
      !url.hash
    ) {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Meta's widget only posts its token to a parent page on a Meta domain (it ignores the
 * GET_ORIGIN reply from any other origin), so it can't be solved inside the CRM. This
 * script mounts the same iframe over an instagram.com tab and shows the token to copy.
 */
function solverScript(src: string) {
  return `(src => {
  if (location.origin !== 'https://www.instagram.com') {
    alert('Cole este script no console de uma aba do www.instagram.com.');
    return;
  }
  document.getElementById('vendua-captcha')?.remove();
  const make = (tag, css) => { const el = document.createElement(tag); el.style.cssText = css; return el; };
  const btn = 'padding:8px 16px;border:1px solid #bbb;border-radius:8px;background:#fff;color:#111;font:inherit;cursor:pointer';
  const box = make('div', 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;overflow:auto;background:#fff;color:#111;font:15px/1.4 system-ui,sans-serif');
  box.id = 'vendua-captcha';
  const note = make('p', 'margin:0;max-width:520px;text-align:center');
  note.textContent = 'Resolva a verificação do Instagram.';
  const frame = make('iframe', 'border:0;width:100%;max-width:520px;height:140px');
  frame.title = 'verificação do Instagram';
  frame.referrerPolicy = 'no-referrer';
  const code = make('textarea', 'display:none;width:100%;max-width:520px;font:12px monospace');
  code.readOnly = true;
  code.rows = 4;
  const copy = make('button', btn + ';display:none');
  copy.type = 'button';
  copy.textContent = 'copiar código';
  const close = make('button', btn);
  close.type = 'button';
  close.textContent = 'fechar';
  const show = on => { code.style.display = copy.style.display = on ? 'block' : 'none'; };
  const onMessage = e => {
    if (e.origin !== 'https://www.fbsbx.com' || e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'GET_ORIGIN') {
      e.source.postMessage({}, e.origin);
    } else if (d.type === 'RESIZE_IFRAME' && Number.isFinite(d.size?.height)) {
      frame.style.height = Math.min(900, Math.max(100, d.size.height)) + 'px';
    } else if (d.type === 'CAPTCHA_EXPIRED') {
      code.value = '';
      show(false);
      note.textContent = 'A verificação expirou. Resolva de novo.';
    } else if (d.type === 'CAPTCHA_SOLVED' && typeof d.token === 'string' && d.token.trim() && d.token.length <= ${TOKEN_MAX}) {
      code.value = d.token;
      show(true);
      copy.textContent = 'copiar código';
      note.textContent = 'Pronto! Copie o código e cole na Venduá em até 2 minutos.';
    }
  };
  copy.onclick = () => navigator.clipboard.writeText(code.value).then(
    () => { copy.textContent = 'copiado ✓'; },
    () => { code.select(); note.textContent = 'Selecione o código e copie com Ctrl+C.'; },
  );
  close.onclick = () => { removeEventListener('message', onMessage); box.remove(); };
  addEventListener('message', onMessage);
  box.append(note, frame, code, copy, close);
  document.body.append(box);
  frame.src = src;
})(${JSON.stringify(src)});
`;
}

export function InstagramCaptcha({
  captcha,
  instructions,
  busy,
  onSubmit,
  onCancel,
}: {
  captcha: IgCaptcha;
  instructions: string;
  busy: boolean;
  onSubmit: (token: string) => void;
  onCancel: () => void;
}) {
  const src = frameURL(captcha.iframeURL);
  const [token, setToken] = useState('');
  // tokens carry no whitespace; a paste often picks up a trailing newline
  const clean = token.replace(/\s+/g, '');
  const valid = clean.length > 0 && clean.length <= TOKEN_MAX;

  const copyScript = () => {
    if (!src) return;
    navigator.clipboard.writeText(solverScript(src)).then(
      () => toast.success('script copiado — cole no console do instagram.com'),
      () => toast.error('não deu para copiar — tente de novo'),
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !valid) return;
    setToken('');
    onSubmit(clean);
  };

  return (
    <form className="flex flex-col gap-2.5" onSubmit={submit}>
      <p className="text-sm">{instructions}</p>
      {src ? (
        <>
          <p className={foot}>
            esse captcha só funciona dentro do instagram.com — por isso ele é resolvido lá, num
            computador:
          </p>
          <ol className={`${foot} list-decimal space-y-1 pl-4`}>
            <li>
              copie o script, abra o instagram.com e aperte F12 → console. cole e dê Enter (na
              primeira vez o navegador pede para digitar{' '}
              <code className="text-sidebar-foreground">allow pasting</code>)
            </li>
            <li>resolva o captcha que aparece e toque em “copiar código”</li>
            <li>cole o código aqui em até 2 minutos</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" className={quiet} disabled={busy} onClick={copyScript}>
              <Copy /> copiar script
            </Button>
            <Button asChild variant="ghost" className={quiet}>
              <a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer">
                <ExternalLink /> abrir instagram.com
              </a>
            </Button>
          </div>
          <Textarea
            aria-label="código do captcha"
            rows={3}
            spellCheck={false}
            autoComplete="off"
            className={`font-mono text-xs break-all ${dark}`}
            placeholder="cole aqui o código do captcha"
            value={token}
            disabled={busy}
            onChange={(e) => setToken(e.target.value)}
          />
        </>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          a verificação não pôde ser carregada. cancele e tente novamente.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {src && (
          <Button type="submit" variant="agent" disabled={busy || !valid}>
            {busy && <Loader2 className="animate-spin" />}
            {busy ? 'verificando…' : 'continuar'}
          </Button>
        )}
        <Button variant="ghost" className={quiet} disabled={busy} onClick={onCancel}>
          cancelar
        </Button>
      </div>
      {src && (
        <p className={foot}>
          o script só desenha o captcha do instagram por cima da página — não lê nada da conta.
        </p>
      )}
    </form>
  );
}
