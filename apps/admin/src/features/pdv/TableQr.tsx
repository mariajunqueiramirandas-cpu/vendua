import { ArrowsClockwise, Printer } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type PdvState, type PdvTable, type PdvTables } from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { CopyValue } from '../../ui/CopyValue.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { tableName } from '../../ui/orderMode.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';
import { pdvError } from './data.ts';
import { QrCard } from './QrCard.tsx';

// One table's QR (ADR 0036): what the customer scans, its link, printing it, and replacing it
// when a printed one leaked. Replacing can't be undone (the old token is dead at once), so it
// is held to confirm rather than offered with "desfazer".

export const qrPrintPath = (tableId?: string) =>
  `/pdv/mesas/qr${tableId ? `?mesa=${encodeURIComponent(tableId)}` : ''}`;

export function TableQrSheet({
  table,
  qrOrders,
  onClose,
}: {
  table: PdvTable | null;
  qrOrders: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const session = useSession();
  const [confirming, setConfirming] = useState(false);
  // keep the last table on screen while the sheet slides away
  const [shown, setShown] = useState(table);
  if (table && table !== shown) setShown(table);
  const t = table ?? shown;
  const openId = table?.id;
  useEffect(() => {
    if (openId) setConfirming(false);
  }, [openId]);

  const renew = useMutation({
    mutationFn: (id: string) => api.pdv.tableQr(id),
    onSuccess: (r) => {
      haptic.commit();
      const put = (ts: PdvTable[]) => ts.map((x) => (x.id === r.table.id ? r.table : x));
      qc.setQueryData<PdvState>(qk.pdv.state, (s) => (s ? { ...s, tables: put(s.tables) } : s));
      qc.setQueryData<PdvTables>(qk.pdv.tables, (s) => (s ? { ...s, tables: put(s.tables) } : s));
      void qc.invalidateQueries({ queryKey: qk.pdv.state });
      setConfirming(false);
      toast(`Novo QR da ${tableName(r.table.label)}. Imprima e troque o da mesa.`, {
        ms: 8000,
        action: { label: 'imprimir', run: () => nav(qrPrintPath(r.table.id)) },
      });
    },
    onError: (e) => {
      haptic.error();
      toast.error(pdvError(e));
    },
  });

  const name = t ? tableName(t.label) : 'mesa';
  return (
    <Sheet
      open={!!table}
      onOpenChange={(o) => !o && onClose()}
      title={`QR da ${name}`}
      description="Quem escaneia abre o cardápio da loja e pede para essa mesa."
    >
      {t ? (
        <div className="space-y-5 pb-2">
          {!qrOrders ? (
            <Notice tone="warning" title="Os pedidos pelo QR estão desligados">
              O QR abre o cardápio, mas a loja não recebe pedidos por ele. Ligue em “Pedidos pelo QR
              da mesa”, logo acima das mesas.
            </Notice>
          ) : null}
          {t.qrUrl ? (
            <>
              <QrCard store={session.store.name} label={t.label} url={t.qrUrl} />
              <CopyValue label="Link da mesa" value={t.qrUrl} copied="Link da mesa copiado" />
              <ButtonLink
                to={qrPrintPath(t.id)}
                replace
                variant="secondary"
                block
                icon={<Printer />}
              >
                imprimir
              </ButtonLink>
            </>
          ) : (
            <p className="t-body rounded-md bg-sunken px-4 py-3 text-muted">
              O QR dessa mesa ainda não está pronto. Tente de novo em instantes.
            </p>
          )}

          <div className="space-y-2 border-t border-line pt-5">
            <p className="font-semibold">Gerar novo QR</p>
            <p className="t-body text-muted">
              Para quando o QR impresso se perdeu ou alguém levou uma foto dele. O QR antigo para de
              funcionar na hora, então imprima o novo e troque o da mesa.
            </p>
            {confirming ? (
              <div className="space-y-3 rounded-md bg-sunken p-4">
                <p className="t-body font-semibold text-danger">
                  O QR impresso da {name} vai parar de funcionar. Não dá para desfazer.
                </p>
                <HoldButton
                  disabled={renew.isPending}
                  onConfirm={() => renew.mutate(t.id)}
                  className="w-full"
                >
                  segure para gerar novo QR
                </HoldButton>
                <Button
                  variant="ghost"
                  block
                  disabled={renew.isPending}
                  onClick={() => setConfirming(false)}
                >
                  deixar como está
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                icon={<ArrowsClockwise />}
                onClick={() => setConfirming(true)}
              >
                gerar novo QR
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
