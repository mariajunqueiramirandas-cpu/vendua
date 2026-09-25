import { useEffect, useState } from 'react';
import { Loader2, Smartphone } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { errorMessage } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { ConfirmButton } from '@/components/common.tsx';
import { fmtPhone, type WaState } from './providers.ts';

/**
 * Pairing panel for an active baileys driver. `resetSignal` bumps whenever the
 * saved row changes or the driver is re-picked — a shown code belongs to the
 * old socket and must go.
 */
export function WhatsAppPairing({
  wa,
  resetSignal,
  testing,
  onReconnect,
  onLogout,
  loggingOut,
}: {
  wa: WaState;
  resetSignal: number;
  testing: boolean;
  onReconnect: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const [pairPhone, setPairPhone] = useState('');
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [qrImg, setQrImg] = useState<string | null>(null);

  useEffect(() => {
    setPairCode(null);
    setPairErr(null);
  }, [resetSignal]);

  useEffect(() => {
    if (!wa.qr) {
      setQrImg(null);
      return;
    }
    let dead = false;
    const payload = wa.qr;
    // the encoder only loads once a QR is actually on screen
    void import('qrcode')
      .then((m) => m.default.toDataURL(payload, { margin: 1, width: 220 }))
      .then((url) => {
        if (!dead) setQrImg(url);
      })
      .catch(() => {
        if (!dead) setQrImg(null);
      });
    return () => {
      dead = true;
    };
  }, [wa.qr]);

  useEffect(() => {
    // 'open' spends the code; 'off' means a shown code can never complete — clear it
    if (wa.status === 'open' || wa.status === 'off') setPairCode(null);
  }, [wa.status]);

  const runPair = async () => {
    setPairBusy(true);
    setPairErr(null);
    try {
      setPairCode((await api.waPairCode(pairPhone)).code);
    } catch (e) {
      setPairErr(errorMessage(e));
    } finally {
      setPairBusy(false);
    }
  };

  const foot = 'text-xs text-sidebar-muted';

  return (
    <div className="mt-3 flex flex-col gap-2.5 rounded-lg bg-sidebar p-3 text-sidebar-foreground">
      {wa.status === 'open' ? (
        <>
          <div className="text-[11px] font-medium tracking-wide text-agent uppercase">
            conectado
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-medium tnum">
              {wa.me?.phone ? fmtPhone(wa.me.phone) : 'número pareado'}
            </span>
            {wa.me?.name && <span className="text-sm text-sidebar-muted">{wa.me.name}</span>}
          </div>
          <p className={foot}>
            o agente já envia e recebe por esse número — desconectar libera o aparelho e emite um QR
            novo.
          </p>
          <div>
            <ConfirmButton
              size="sm"
              variant="destructive-outline"
              confirm="desconectar mesmo?"
              disabled={loggingOut}
              onConfirm={onLogout}
            >
              desconectar número
            </ConfirmButton>
          </div>
        </>
      ) : wa.status === 'off' ? (
        <>
          <div className="text-[11px] font-medium tracking-wide text-warning uppercase">
            socket parado
          </div>
          <p className={foot}>
            o driver está ativo mas o socket não está rodando — ele religa sozinho depois de uma
            queda; se o número foi desvinculado, pareie de novo.
          </p>
          <div>
            <Button size="sm" variant="agent" disabled={testing} onClick={onReconnect}>
              {testing && <Loader2 className="animate-spin" />}
              {testing ? 'religando…' : 'reconectar agora'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="text-sm font-medium">
            {wa.qr
              ? 'parear — whatsapp → aparelhos conectados → conectar aparelho'
              : 'conectando ao whatsapp…'}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            {wa.qr && qrImg && (
              <img
                className="size-[180px] shrink-0 self-center rounded-md sm:self-start"
                src={qrImg}
                alt="QR do whatsapp"
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className={foot}>
                ou conectar com código — o número precisa ser o da conta whatsapp no aparelho que
                vai parear:
              </p>
              {pairCode && (
                <code className="self-start rounded-md bg-sidebar-accent px-2.5 py-1 font-mono text-lg tracking-[0.2em] text-agent">
                  {pairCode}
                </code>
              )}
              <div className="flex gap-2">
                <Input
                  inputMode="tel"
                  placeholder="DDI+DDD+número — 5511…"
                  value={pairPhone}
                  onChange={(e) => {
                    setPairPhone(e.target.value);
                    setPairCode(null);
                  }}
                  className="border-sidebar-border bg-sidebar-accent text-sidebar-foreground placeholder:text-sidebar-muted"
                />
                <Button
                  variant="agent"
                  disabled={pairBusy}
                  onClick={() => void runPair()}
                  className="shrink-0"
                >
                  <Smartphone />
                  {pairBusy ? 'gerando…' : pairCode ? 'novo código' : 'gerar código'}
                </Button>
              </div>
              {pairErr && <p className="text-xs text-destructive">{pairErr}</p>}
            </div>
          </div>
          <p className={foot}>QR e código expiram rápido — esta tela atualiza sozinha</p>
        </>
      )}
    </div>
  );
}
