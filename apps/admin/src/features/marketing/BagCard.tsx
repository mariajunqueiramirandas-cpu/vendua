import { Printer } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Coupon } from '../../lib/api.ts';
import { money, num } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState } from '../../ui/feedback.tsx';
import { Select } from '../../ui/fields.tsx';
import { ActionBar, PageBody, PageHeader } from '../../ui/Page.tsx';
import { Qr } from '../../ui/Qr.tsx';
import { Bone } from '../../ui/skeletons.tsx';

// Marketing › Cartão da sacola: a card for the bag of every order that came through a delivery
// app, so next time the shopper orders on the store's own site. Four per A4, a dashed edge to
// cut along. A coupon on the card (`?cupom=` on its QR) is how the owner sees what it brought
// back: its uses and revenue are the coupon's own. Printing works as in MesasQr.tsx.

const PER_PAGE = 4;

const PRINT_CSS = `
#sacola-folha { display: none; }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html[data-bag-print] body > *:not(#sacola-folha) { display: none !important; }
  html[data-bag-print] body { background: none !important; }
  html[data-bag-print] body::before, html[data-bag-print] body::after { display: none !important; }
  #sacola-folha { display: block; }
}
`;

const usable = (c: Coupon) =>
  c.active &&
  (!c.endsAt || new Date(c.endsAt) > new Date()) &&
  (c.maxRedemptions === null || c.redemptions < c.maxRedemptions);

export default function BagCardPage() {
  const s = useSession();
  const { data, error, refetch } = useQuery({ queryKey: qk.marketing, queryFn: api.marketing });
  const [params, setParams] = useSearchParams();
  const coupons = (data?.coupons ?? []).filter(usable);
  const coupon = coupons.find((c) => c.id === params.get('cupom')) ?? null;
  const base = s.store.url.replace(/\/$/, '');
  const url = coupon ? `${base}/?cupom=${encodeURIComponent(coupon.code)}` : `${base}/`;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.bagPrint = '';
    return () => void delete root.dataset.bagPrint;
  }, []);

  const card = (paper?: boolean) => (
    <BagCard
      store={s.store.name}
      url={url}
      host={base.replace(/^https?:\/\//, '')}
      coupon={coupon}
      {...(paper ? { paper } : {})}
    />
  );

  return (
    <PageBody>
      <PageHeader
        title="Cartão da sacola"
        back="/marketing/divulgar"
        subtitle="Para a sacola dos pedidos que chegam pelos apps de delivery: da próxima vez, o cliente pede direto pelo seu site."
        actions={
          <Button icon={<Printer />} onClick={() => window.print()}>
            imprimir
          </Button>
        }
      />
      {error && !data ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : !data ? (
        <Bone className="h-[30rem] rounded-lg" />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
          <div className="mx-auto w-full max-w-sm lg:order-2">{card()}</div>
          <div className="space-y-6">
            <Section
              title="Cupom no cartão"
              hint="Com um cupom, você vê quantos clientes o cartão trouxe de volta."
            >
              <Card className="space-y-4 p-5">
                {coupons.length ? (
                  <Select
                    label="cupom no cartão"
                    value={coupon?.id ?? ''}
                    onChange={(id) =>
                      setParams(id ? { cupom: id } : {}, {
                        replace: true,
                        preventScrollReset: true,
                      })
                    }
                    options={[
                      { value: '', label: 'Sem cupom' },
                      ...coupons.map((c) => ({
                        value: c.id,
                        label: `${c.code} · ${c.displayLabel}`,
                      })),
                    ]}
                  />
                ) : (
                  <p className="t-body text-muted">
                    Nenhum cupom ativo. Crie um de primeira compra em{' '}
                    <Link to="/marketing" className="font-semibold text-ink underline">
                      Marketing
                    </Link>{' '}
                    e volte aqui para pôr no cartão.
                  </p>
                )}
                {coupon ? (
                  <p className="t-body">
                    {coupon.redemptions
                      ? `Usado ${num(coupon.redemptions)} ${coupon.redemptions === 1 ? 'vez' : 'vezes'}, ${money(coupon.revenueCents)} em pedidos.`
                      : 'Ainda não foi usado.'}{' '}
                    <span className="text-muted">
                      Conta tudo o que usou esse cupom: use um só para o cartão.
                    </span>
                  </p>
                ) : null}
              </Card>
            </Section>
            <ul className="t-body space-y-2 text-muted">
              <li>Quatro cartões por folha A4. Imprima e recorte na linha.</li>
              <li>O QR abre o seu site{coupon ? ' com o cupom já aplicado' : ''}.</li>
            </ul>
          </div>
        </div>
      )}
      <ActionBar>
        <Button size="lg" block icon={<Printer />} onClick={() => window.print()}>
          imprimir 4 por folha
        </Button>
      </ActionBar>
      <style>{PRINT_CSS}</style>
      {data
        ? createPortal(
            <div id="sacola-folha" aria-hidden className="text-qr">
              <div className="grid h-[272mm] grid-cols-2 grid-rows-2 gap-[6mm]">
                {Array.from({ length: PER_PAGE }, (_, i) => (
                  <div key={i} className="min-h-0">
                    {card(true)}
                  </div>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </PageBody>
  );
}

/** One card, dark on the QR paper in either theme, the way it comes out of the printer. */
function BagCard({
  store,
  url,
  host,
  coupon,
  paper,
}: {
  store: string;
  url: string;
  host: string;
  coupon: Coupon | null;
  paper?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center bg-qr-paper text-center text-qr',
        paper
          ? 'h-full justify-center gap-[2.5mm] rounded-[4mm] border-[0.3mm] border-dashed border-qr/40 p-[6mm] [&>*]:shrink-0'
          : 'gap-2 rounded-lg p-6 ring-1 ring-line depth-1',
      )}
    >
      <p
        className={cn(
          'w-full truncate font-semibold uppercase tracking-[0.08em] opacity-75',
          paper ? 'text-[4mm]' : 't-caption',
        )}
      >
        {store}
      </p>
      <p
        className={cn(
          'text-balance font-display font-semibold leading-tight',
          paper ? 'text-[6.5mm]' : 'text-[1.375rem]',
        )}
      >
        Da próxima vez, peça direto com a gente
      </p>
      <Qr
        value={url}
        alt={`QR code para ${host}`}
        className={cn('aspect-square', paper ? 'w-[58mm]' : 'my-1 w-full max-w-52')}
      />
      {coupon ? (
        <div
          className={cn(
            'w-full rounded-md bg-qr/[0.06]',
            paper ? 'px-[3mm] py-[2mm]' : 'px-3 py-2',
          )}
        >
          <p
            className={cn('font-display font-bold leading-none', paper ? 'text-[7mm]' : 'text-2xl')}
          >
            {coupon.code}
          </p>
          <p className={cn('mt-1 opacity-80', paper ? 'text-[3.4mm]' : 't-caption')}>
            {coupon.displayLabel}
            {coupon.firstOrderOnly ? ' na primeira compra pelo site' : ''}
          </p>
        </div>
      ) : null}
      <p className={cn('w-full break-all opacity-75', paper ? 'text-[3.6mm]' : 't-caption')}>
        {host}
      </p>
    </div>
  );
}
