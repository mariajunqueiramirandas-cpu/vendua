import { Printer } from '@phosphor-icons/react';
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import type { PdvTable } from '../../lib/api.ts';
import { isPlanRequired, useCan, useFeature, useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { EmptyState, ErrorState } from '../../ui/feedback.tsx';
import { ArtStore } from '../../ui/illustrations.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { tableName } from '../../ui/orderMode.ts';
import { ActionBar, PageHeader } from '../../ui/Page.tsx';
import { LockedPage, PlanLocked, reasonOf } from '../../ui/PlanLocked.tsx';
import { Bone } from '../../ui/skeletons.tsx';
import { usePdvState } from './data.ts';
import { QrCard } from './QrCard.tsx';

// The QR codes to put on the tables (ADR 0036), on screen as a preview and on A4 when printed:
// four cards a page, with a dashed edge to cut along. `?mesa=<id>` prints just that table.
// The printed copy is a second render outside the app's root, so the print stylesheet can drop
// the whole app (rail, bars, toasts) and keep only the sheet.

const PER_PAGE = 4;

const PRINT_CSS = `
#qr-folha { display: none; }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html[data-qr-print] body > *:not(#qr-folha) { display: none !important; }
  html[data-qr-print] body { background: none !important; }
  html[data-qr-print] body::before, html[data-qr-print] body::after { display: none !important; }
  #qr-folha { display: block; }
}
`;

export default function MesasQr() {
  return useFeature('pdv') ? <QrScreen /> : <LockedPage title="QR das mesas" feature="pdv" />;
}

function QrScreen() {
  const { data, error, refetch } = usePdvState();
  const session = useSession();
  const manager = useCan('manager');
  const [params] = useSearchParams();
  const only = params.get('mesa');

  const all = useMemo(() => [...(data?.tables ?? [])].sort((a, b) => a.sort - b.sort), [data]);
  const picked = only ? all.filter((t) => t.id === only) : all;
  const ready = picked.filter((t) => !!t.qrUrl);
  const single = only && picked.length === 1 ? picked[0]! : null;
  const title = single ? `QR da ${tableName(single.label)}` : 'QR das mesas';

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.qrPrint = '';
    return () => void delete root.dataset.qrPrint;
  }, []);

  const print = () => window.print();
  const canPrint = ready.length > 0;

  const body = (c: React.ReactNode) => (
    <div className="mx-auto w-full max-w-[1100px] px-4 pb-32 pt-4 md:px-8 md:pb-16 md:pt-8">
      {c}
    </div>
  );

  if (isPlanRequired(error))
    return body(<PlanLocked feature="pdv" reason={reasonOf(error)} refresh />);

  return body(
    <>
      <PageHeader
        title={title}
        back="/pdv/mesas"
        subtitle={
          single
            ? 'Imprima, recorte na linha e deixe na mesa.'
            : 'Quatro por folha A4. Imprima, recorte na linha e deixe um em cada mesa.'
        }
        actions={
          canPrint ? (
            <Button icon={<Printer />} onClick={print}>
              imprimir
            </Button>
          ) : null
        }
      />

      {error && !data ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: 3 }, (_, i) => (
            <Bone key={i} className="h-[26rem] rounded-lg" delay={i * 60} />
          ))}
        </div>
      ) : picked.length === 0 ? (
        only ? (
          <EmptyState
            art={<ArtStore />}
            title="Essa mesa não está mais no salão"
            body="Ela pode ter sido removida. Os QR das outras mesas continuam aqui."
            action={
              <ButtonLink to="/pdv/mesas/qr" replace variant="secondary">
                ver todas as mesas
              </ButtonLink>
            }
          />
        ) : (
          <EmptyState
            art={<ArtStore />}
            title="Nenhuma mesa ainda"
            body={
              manager
                ? 'Crie as mesas em Mesas, no botão “editar mesas”. Cada uma ganha o seu QR.'
                : 'Quem é gerente cria as mesas. Cada uma ganha o seu QR.'
            }
            action={
              <ButtonLink to="/pdv/mesas" variant="secondary">
                ir para Mesas
              </ButtonLink>
            }
          />
        )
      ) : (
        <div className="space-y-5">
          {!data.qrOrders ? (
            <Notice
              tone="warning"
              title="Os pedidos pelo QR estão desligados"
              action={
                manager ? (
                  <ButtonLink to="/pdv/mesas" variant="secondary" size="sm" className="min-h-11">
                    ligar em Mesas
                  </ButtonLink>
                ) : undefined
              }
            >
              {manager
                ? 'O QR abre o cardápio, mas a loja não recebe pedidos por ele. Ligue em Mesas, no botão “editar mesas”.'
                : 'O QR abre o cardápio, mas a loja não recebe pedidos por ele até alguém da gerência ligar.'}
            </Notice>
          ) : null}
          {ready.length < picked.length ? (
            <p className="t-body rounded-md bg-sunken px-4 py-3 text-muted" role="status">
              {picked.length - ready.length === 1
                ? 'O QR de uma mesa ainda não está pronto e fica de fora da impressão.'
                : `O QR de ${picked.length - ready.length} mesas ainda não está pronto e fica de fora da impressão.`}
            </p>
          ) : null}
          <ul
            aria-label="QR codes das mesas"
            className={
              single
                ? 'mx-auto max-w-sm'
                : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>li]:min-w-0'
            }
          >
            {ready.map((t) => (
              <li key={t.id}>
                <QrCard store={session.store.name} label={t.label} url={t.qrUrl} />
              </li>
            ))}
          </ul>
          {only ? (
            <p className="t-body text-center text-muted">
              <Link
                to="/pdv/mesas/qr"
                replace
                className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-2"
              >
                ver o QR de todas as mesas
              </Link>
            </p>
          ) : null}
        </div>
      )}

      {canPrint ? (
        <ActionBar>
          <Button size="lg" block icon={<Printer />} onClick={print}>
            {ready.length === 1 ? 'imprimir' : `imprimir ${ready.length} QR`}
          </Button>
        </ActionBar>
      ) : null}

      <style>{PRINT_CSS}</style>
      {canPrint
        ? createPortal(<Paper store={session.store.name} tables={ready} />, document.body)
        : null}
    </>,
  );
}

/** What the printer gets: A4 pages of four cards, each page its own sheet. */
function Paper({ store, tables }: { store: string; tables: PdvTable[] }) {
  const pages: PdvTable[][] = [];
  for (let i = 0; i < tables.length; i += PER_PAGE) pages.push(tables.slice(i, i + PER_PAGE));
  return (
    <div id="qr-folha" aria-hidden className="text-qr">
      {pages.map((page, i) => (
        <div
          key={i}
          className="grid h-[272mm] grid-cols-2 grid-rows-2 gap-[6mm] break-inside-avoid"
          style={{ breakAfter: i < pages.length - 1 ? 'page' : 'auto' }}
        >
          {page.map((t) => (
            <QrCard key={t.id} paper store={store} label={t.label} url={t.qrUrl} />
          ))}
        </div>
      ))}
    </div>
  );
}
