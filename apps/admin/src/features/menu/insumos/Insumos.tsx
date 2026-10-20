import {
  Camera,
  ListChecks,
  MagnifyingGlass,
  Package,
  Plus,
  ShoppingCart,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Insumo, type InsumosList, type OrderMode } from '../../../lib/api.ts';
import { money } from '../../../lib/format.ts';
import { qk } from '../../../lib/query.ts';
import { useSession } from '../../../lib/session.ts';
import { Button } from '../../../ui/Button.tsx';
import { Card, Section } from '../../../ui/Card.tsx';
import { cn } from '../../../ui/cn.ts';
import { EmptyState, ErrorState, Hint } from '../../../ui/feedback.tsx';
import { Segmented, TextInput } from '../../../ui/fields.tsx';
import { Mascote } from '../../../ui/Mascote.tsx';
import { PageBody, PageHeader } from '../../../ui/Page.tsx';
import { ChipsSkeleton, RowsSkeleton } from '../../../ui/skeletons.tsx';
import { MenuTabs } from '../MenuTabs.tsx';
import { PerOrderSheet, PurchaseSheet, ShoppingSheet, type Prefill } from './Compras.tsx';
import { PhotoSheet } from './Foto.tsx';
import { InsumoSheet, NewInsumoSheet } from './InsumoSheet.tsx';
import { stockStatus } from './status.tsx';
import { costLabel, MODE_LABEL, qty } from './units.ts';

// Cardápio › Insumos: what the store buys and makes, how much is left, what it costs. Each sale
// draws the fichas técnicas by itself; this screen is for what arrives, what's counted and lost.

type Filter = 'repor' | 'insumos' | 'preparos';

export default function Insumos() {
  const { data, error, refetch, isPending } = useQuery({
    queryKey: qk.insumos,
    queryFn: api.insumos,
  });
  const store = useSession().store.name;
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter | null>(null);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<'insumo' | 'preparo' | null>(null);
  const [buying, setBuying] = useState<Prefill | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);

  const all = useMemo(() => data?.insumos ?? [], [data]);
  const counts = {
    repor: all.filter((i) => i.low).length,
    insumos: all.filter((i) => i.kind === 'insumo').length,
    preparos: all.filter((i) => i.kind === 'preparo').length,
  };
  const shown: Filter = filter ?? (counts.repor ? 'repor' : 'insumos');
  const needle = q.trim().toLocaleLowerCase('pt-BR');
  const rows = all.filter(
    (i) =>
      (shown === 'repor'
        ? i.low
        : shown === 'insumos'
          ? i.kind === 'insumo'
          : i.kind === 'preparo') &&
      (!needle || i.name.toLocaleLowerCase('pt-BR').includes(needle)),
  );
  const open = all.find((i) => i.id === openId) ?? null;

  // from Início's "acabando" or a ficha's "ver insumo": open on that one
  const focus = params.get('i');
  useEffect(() => {
    if (!focus || !data) return;
    setParams({}, { replace: true });
    if (data.insumos.some((i) => i.id === focus)) setOpenId(focus);
  }, [focus, data, setParams]);

  const counted = all.filter((i) => i.stockMilli != null).length;
  const subtitle = data
    ? all.length
      ? `${all.length} ${all.length === 1 ? 'insumo' : 'insumos'}${counted ? ` · ${counted} contando` : ''}${counts.repor ? ` · ${counts.repor} para repor` : ''}`
      : 'Nada cadastrado ainda'
    : undefined;

  const add = (
    <Button icon={<Plus />} onClick={() => setCreating('insumo')} className="shrink-0">
      novo insumo
    </Button>
  );

  return (
    <PageBody wide>
      <PageHeader title="Cardápio" subtitle={subtitle} actions={all.length ? add : undefined} />
      <MenuTabs />
      <div className="max-w-[880px]">
        {error && !data ? (
          <ErrorState error={error} retry={() => void refetch()} />
        ) : isPending ? (
          <div className="space-y-4">
            <ChipsSkeleton count={3} />
            <RowsSkeleton rows={6} avatar={false} />
          </div>
        ) : !all.length ? (
          <EmptyState
            art={<Mascote pose="catalogo" />}
            title="Nenhum insumo ainda"
            body="Cadastre o que você compra, como pão, queijo e caixa, e diga na ficha de cada produto quanto vai. Cada venda desconta sozinha, e você vê o custo e a margem de verdade."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon={<Plus />} onClick={() => setCreating('insumo')}>
                  cadastrar insumo
                </Button>
                <Button variant="secondary" icon={<Camera />} onClick={() => setPhotoOpen(true)}>
                  foto da nota ou lista
                </Button>
                <Button variant="secondary" onClick={() => setCreating('preparo')}>
                  criar um preparo
                </Button>
              </div>
            }
          />
        ) : (
          <>
            <Overview
              data={data!}
              low={counts.repor}
              onBuy={() => setBuying({ items: [] })}
              onList={() => setListOpen(true)}
              onPhoto={() => setPhotoOpen(true)}
            />
            <Hint id="insumos-screen" className="mb-5">
              Cada venda desconta da ficha técnica sozinha, e um cancelamento devolve. Faltar insumo
              nunca trava uma venda: a conta fica abaixo de zero e aparece aqui para repor.
            </Hint>
            <Segmented
              label="mostrar"
              value={shown}
              onChange={setFilter}
              className="mb-4"
              options={[
                { value: 'repor', label: 'Para repor', count: counts.repor },
                { value: 'insumos', label: 'Insumos', count: counts.insumos },
                { value: 'preparos', label: 'Preparos', count: counts.preparos },
              ]}
            />
            <div className="mb-4 flex gap-2">
              {all.length > 8 ? (
                <div className="min-w-0 flex-1">
                  <TextInput
                    type="search"
                    aria-label="buscar insumo"
                    placeholder="Buscar insumo"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    lead={<MagnifyingGlass className="size-5" />}
                  />
                </div>
              ) : null}
              <Button
                variant="secondary"
                icon={<Plus />}
                className={cn('h-13 shrink-0 md:hidden', all.length <= 8 && 'flex-1')}
                onClick={() => setCreating(shown === 'preparos' ? 'preparo' : 'insumo')}
              >
                {shown === 'preparos' ? 'novo preparo' : 'novo insumo'}
              </Button>
            </div>

            {rows.length ? (
              <Card className="divide-y divide-line overflow-hidden">
                {rows.map((i) => (
                  <InsumoRow key={i.id} i={i} onOpen={() => setOpenId(i.id)} />
                ))}
              </Card>
            ) : (
              <EmptyFilter
                shown={shown}
                q={q}
                onNew={() => setCreating(shown === 'preparos' ? 'preparo' : 'insumo')}
              />
            )}

            <PerOrderCard data={data!} onEdit={() => setPackOpen(true)} />
          </>
        )}
      </div>

      <InsumoSheet
        insumo={open}
        all={all}
        onClose={() => setOpenId(null)}
        onBuy={(i) => {
          setOpenId(null);
          // after the insumo sheet's history entry is gone, or its back-pop closes this one too
          setTimeout(() => setBuying({ items: [{ id: i.id }] }), 320);
        }}
      />
      <NewInsumoSheet
        kind={creating}
        all={all}
        onClose={() => setCreating(null)}
        onCreated={(i) => {
          setCreating(null);
          setFilter(i.kind === 'preparo' ? 'preparos' : 'insumos');
          // a new preparo goes straight to its ficha
          if (i.kind === 'preparo') setTimeout(() => setOpenId(i.id), 320);
        }}
      />
      <PurchaseSheet prefill={buying} all={all} onClose={() => setBuying(null)} />
      <PhotoSheet open={photoOpen} all={all} onClose={() => setPhotoOpen(false)} />
      <ShoppingSheet
        open={listOpen}
        items={all.filter((i) => i.low)}
        store={store}
        onClose={() => setListOpen(false)}
        onArrived={(items) => {
          setListOpen(false);
          setTimeout(() => setBuying({ items }), 320);
        }}
      />
      <PerOrderSheet open={packOpen} data={data ?? null} onClose={() => setPackOpen(false)} />
    </PageBody>
  );
}

function Overview({
  data,
  low,
  onBuy,
  onList,
  onPhoto,
}: {
  data: InsumosList;
  low: number;
  onBuy: () => void;
  onList: () => void;
  onPhoto: () => void;
}) {
  const uncosted = data.insumos.filter(
    (i) => i.kind === 'insumo' && i.costPerKCents == null,
  ).length;
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 pl-4 pr-3">
      <div className="min-w-0 flex-1 py-0.5">
        {data.valueCents ? (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="t-caption text-muted">Valor em insumos</span>
            <span className="tnum text-[1.125rem] font-bold">{money(data.valueCents)}</span>
          </p>
        ) : (
          <p className="t-caption text-muted">
            Conte o estoque e ponha o custo para ver quanto vale o que tem.
          </p>
        )}
        {uncosted ? (
          <p className="t-caption">
            <span className="tnum font-semibold text-warning">{uncosted} sem custo</span>
            <span className="text-muted"> · entram como R$ 0 nas fichas</span>
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Camera />} className="h-11" onClick={onPhoto}>
          foto ou print
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<ShoppingCart />}
          className="h-11"
          onClick={onBuy}
        >
          registrar compra
        </Button>
        {low ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<ListChecks />}
            className="h-11"
            onClick={onList}
          >
            lista de compras
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function InsumoRow({ i, onOpen }: { i: Insumo; onOpen: () => void }) {
  const cost = costLabel(i.costPerKCents, i.unit);
  const counted = i.stockMilli != null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press-row flex min-h-18 w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-hover sm:px-4"
    >
      <span className="min-w-0 flex-1 py-1">
        <span className="line-clamp-2 font-semibold leading-snug">
          {i.name}
          {i.kind === 'preparo' ? (
            <span className="t-caption ml-1.5 rounded-full bg-sunken px-2 py-0.5 align-[1px] font-semibold text-muted">
              preparo
            </span>
          ) : null}
        </span>
        <span className="t-caption mt-0.5 block">{stockStatus(i)}</span>
        <span className="t-caption block truncate text-muted">
          {cost ? (
            <span className="tnum">{cost}</span>
          ) : i.kind === 'insumo' ? (
            <span className="font-semibold text-warning">sem custo</span>
          ) : (
            'sem ficha'
          )}
          {i.uses ? ` · em ${i.uses} ${i.uses === 1 ? 'ficha' : 'fichas'}` : ' · em nenhuma ficha'}
        </span>
      </span>
      {counted ? (
        <span
          className={cn(
            'tnum shrink-0 rounded-full bg-sunken px-3.5 py-2 text-[1.0625rem] font-bold',
            i.stockMilli! <= 0 ? 'text-danger' : i.low ? 'text-warning' : 'text-ink',
          )}
        >
          {qty(i.stockMilli!, i.unit)}
        </span>
      ) : (
        <span className="t-label shrink-0 rounded-md px-3 py-2 text-primary">contar</span>
      )}
    </button>
  );
}

function EmptyFilter({ shown, q, onNew }: { shown: Filter; q: string; onNew: () => void }) {
  if (q.trim())
    return <p className="t-body px-1 py-6 text-center text-muted">Nada com “{q.trim()}”.</p>;
  if (shown === 'repor')
    return (
      <p className="t-body rounded-lg bg-sunken px-4 py-6 text-center text-muted">
        Nada para repor. Quando um insumo contado chegar no aviso, ele aparece aqui.
      </p>
    );
  return (
    <div className="rounded-lg bg-sunken px-4 py-6 text-center">
      <p className="t-body text-muted">
        {shown === 'preparos'
          ? 'Um preparo é feito aí, de outros insumos: um molho, uma massa, um recheio. Ele tem a ficha dele e entra nos produtos como um insumo.'
          : 'Nenhum insumo comprado ainda.'}
      </p>
      <Button variant="secondary" icon={<Plus />} className="mt-3" onClick={onNew}>
        {shown === 'preparos' ? 'novo preparo' : 'novo insumo'}
      </Button>
    </div>
  );
}

function PerOrderCard({ data, onEdit }: { data: InsumosList; onEdit: () => void }) {
  const modes: OrderMode[] = ['delivery', 'pickup', 'dine_in'];
  return (
    <Section
      title="Embalagem de cada pedido"
      hint="Sacola, guardanapo, sachê: o que sai em todo pedido, além da ficha de cada produto."
      className="mt-8"
      action={
        <Button size="sm" variant="secondary" icon={<Package />} className="h-11" onClick={onEdit}>
          {data.perOrder.length ? 'editar' : 'definir'}
        </Button>
      }
    >
      {data.perOrder.length ? (
        <Card className="px-4 py-3">
          <p className="t-body">
            {data.perOrder
              .map(
                (l) =>
                  `${qty(l.qtyMilli, l.unit)} ${l.name}${l.mode ? ` (${MODE_LABEL[l.mode].toLowerCase()})` : ''}`,
              )
              .join(' · ')}
          </p>
          <p className="t-caption mt-1 text-muted">
            {modes.map((m, k) => (
              <span key={m}>
                {k ? ' · ' : ''}
                {MODE_LABEL[m]}{' '}
                <span className="tnum font-semibold text-ink">{money(data.perOrderCents[m])}</span>
              </span>
            ))}
          </p>
        </Card>
      ) : (
        <p className="t-body rounded-lg bg-sunken px-4 py-3 text-muted">
          Nada definido. Cada pedido conta só a ficha dos produtos.
        </p>
      )}
    </Section>
  );
}
