import { BellRinging, DeviceMobile, Export, PlusSquare, X } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../../lib/api.ts';
import { currentSubscription, enablePush, pushSupported } from '../../lib/push.ts';
import { installMode, onInstallChange, promptInstall, standalone } from '../../lib/pwa.ts';
import { qk } from '../../lib/query.ts';
import { useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';

// One nudge at a time for this device: first put the app on the home screen,
// then let it ring for new orders with the app closed. Each can be dismissed.

const KEY = (id: string) => `vendua-device-card:${id}`;
const dismissed = (id: string) => {
  try {
    return localStorage.getItem(KEY(id)) === '1';
  } catch {
    return false;
  }
};

function usePushOff() {
  const s = useSession();
  const [off, setOff] = useState(false);
  useEffect(() => {
    if (!s.push.publicKey || !pushSupported() || Notification.permission === 'denied') return;
    void currentSubscription().then((sub) => setOff(!sub));
  }, [s.push.publicKey]);
  return off;
}

export function DeviceCard({ className }: { className?: string }) {
  const s = useSession();
  const qc = useQueryClient();
  const mode = useSyncExternalStore(onInstallChange, installMode);
  const pushOff = usePushOff();
  const [hidden, setHidden] = useState<string[]>([]);
  const [howto, setHowto] = useState(false);
  const [busy, setBusy] = useState(false);

  const card: 'install' | 'push' | null =
    mode && !dismissed('install') && !hidden.includes('install')
      ? 'install'
      : // on iPhone only the installed app can receive notifications
        pushOff &&
          (standalone() || mode !== 'ios') &&
          !dismissed('push') &&
          !hidden.includes('push')
        ? 'push'
        : null;
  if (!card) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY(card), '1');
    } catch {
      /* private mode: gone for this visit */
    }
    setHidden((h) => [...h, card]);
  };

  return (
    <Card className={className}>
      <div className="flex items-start gap-4 p-5">
        <span className="grid size-12 shrink-0 place-items-center rounded-md bg-spark-soft">
          {card === 'install' ? (
            <DeviceMobile weight="duotone" className="size-7" aria-hidden />
          ) : (
            <BellRinging weight="duotone" className="size-7" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="t-label">
            {card === 'install'
              ? 'Tenha a loja na tela do celular'
              : 'Saiba de cada pedido na hora'}
          </h2>
          <p className="t-body mt-1 text-muted">
            {card === 'install'
              ? 'Abre num toque, funciona sem internet e avisa quando chega pedido.'
              : 'Toca e vibra mesmo com o app fechado. Dá para aceitar direto do aviso.'}
          </p>
          <Button
            size="sm"
            className="mt-3"
            loading={busy}
            onClick={async () => {
              if (card === 'install') {
                if (mode === 'ios') return setHowto(true);
                if (await promptInstall()) toast('Pronto! O app está na sua tela de início.');
                return;
              }
              setBusy(true);
              try {
                const r = await enablePush(s.push.publicKey!);
                if (r === 'on') {
                  await api.updateMe({ prefs: { push: true } });
                  void qc.invalidateQueries({ queryKey: qk.session });
                  toast('Avisos ligados neste aparelho.');
                  setHidden((h) => [...h, 'push']);
                } else if (r === 'denied')
                  toast.error('Os avisos foram bloqueados. Libere nas configurações do aparelho.');
              } catch (e) {
                toast.error(messageOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {card === 'install' ? 'instalar o app' : 'ligar os avisos'}
          </Button>
        </div>
        <button
          type="button"
          aria-label="agora não"
          onClick={dismiss}
          className="-mr-2 -mt-2 grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-hover"
        >
          <X className="size-4" />
        </button>
      </div>
      <Sheet open={howto} onOpenChange={setHowto} title="Instalar no iPhone">
        <ol className="t-body-lg space-y-4 pt-1">
          <li className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken">
              <Export className="size-5" aria-hidden />
            </span>
            <span>
              Toque em <b>Compartilhar</b> na barra do Safari.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken">
              <PlusSquare className="size-5" aria-hidden />
            </span>
            <span>
              Escolha <b>Adicionar à Tela de Início</b> e toque em <b>Adicionar</b>.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken">
              <BellRinging className="size-5" aria-hidden />
            </span>
            <span>Abra pelo ícone novo e ligue os avisos de pedido.</span>
          </li>
        </ol>
      </Sheet>
    </Card>
  );
}
