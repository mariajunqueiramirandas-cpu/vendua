import {
  CaretDown,
  CheckSquare,
  ClockCounterClockwise,
  Copy,
  ListChecks,
  MagnifyingGlass,
  Minus,
  Plus,
  Square,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePreload } from '../../app/routes.ts';
import {
  api,
  type Addon,
  type Category,
  type Product,
  type StockMovement,
  type StockOverview,
  type StockReason,
} from '../../lib/api.ts';
import { ago, money, num, when } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { moneyInput, parseMoney } from '../../lib/parse.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { copyText } from '../../ui/CopyValue.tsx';
import { DuaNote, EmptyState, ErrorState, Hint, messageOf } from '../../ui/feedback.tsx';
import { Field, Segmented, Stepper, TextInput } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { ChipsSkeleton, RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { PricingSheet } from './PricingSheet.tsx';

// Every product's and adicional's count on one screen: − and + for the day-to-day, a tap on the
// number to type a count, a delivery or a loss. Taps go to Core as relative changes, batched once
// the finger pauses, so a sale drawn meanwhile is never overwritten by what this screen saw.

type Kind = 'produtos' | 'adicionais';
type Filter = 'repor' | 'contando' | 'sem';
type Catalog = { categories: Category[] };
type Addons = { addons: Addon[] };
/** what the taps, the count sheet and the shopping list work on */
type Subject = { type: 'product'; p: Product } | { type: 'addon'; a: Addon };
type Counted = {
  name: string;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  costCents?: number | null;
};
type Change = { sk: string; add: number; reason?: StockReason };
type Patch = {
  stockQuantity?: number | null;
  lowStockThreshold?: number | null;
  costCents?: number | null;
};

const MAX = 1_000_000;
const FLUSH_MS = 700;

// Core's own rules (modules/catalog.ts): stock 0 reads sold out; low is 1..threshold
const isLow = (n: number, threshold: number | null) => n > 0 && threshold != null && n <= threshold;
const needs = (p: Product) => p.stockQuantity != null && (p.stockQuantity === 0 || p.lowStock);
// one no longer offered is counted, but nobody buys more of it
const needsAddon = (a: Addon) =>
  a.stockQuantity != null && a.productCount > 0 && (a.stockQuantity === 0 || a.lowStock);

/** taps and history key: `p:<id>` or `a:<key>` */
const skOf = (s: Subject) => (s.type === 'product' ? `p:${s.p.id}` : `a:${s.a.key}`);
const view = (s: Subject): Counted => (s.type === 'product' ? s.p : s.a);

function withStock(p: Product, n: number): Product {
  return {
    ...p,
    stockQuantity: n,
    lowStock: isLow(n, p.lowStockThreshold),
    liveStatus: p.status === 'active' ? (n === 0 ? 'sold_out' : 'active') : p.liveStatus,
  };
}
// a guess until Core answers: every option may also be marked esgotado by hand
const withAddonStock = (a: Addon, n: number): Addon => ({
  ...a,
  stockQuantity: n,
  lowStock: isLow(n, a.lowStockThreshold),
  status: n === 0 ? 'sold_out' : a.stockQuantity === 0 ? 'active' : a.status,
});

const mapProducts = (d: Catalog, fn: (p: Product) => Product): Catalog => ({
  ...d,
  categories: d.categories.map((c) => ({ ...c, products: c.products.map(fn) })),
});

/** "em X-Burger, X-Salada e mais 3" */
function usedIn(a: Addon) {
  const names = a.products.map((p) => p.name);
  if (!names.length) return `em ${a.productCount} ${a.productCount === 1 ? 'produto' : 'produtos'}`;
  if (a.productCount <= 3 && names.length >= a.productCount)
    return `em ${names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : names[0]}`;
  const shown = names.slice(0, 2);
  return `em ${shown.join(', ')} e mais ${a.productCount - shown.length}`;
}

export default function Stock() {
  const { data, error, refetch, isPending } = useQuery({
    queryKey: qk.catalog,
    queryFn: api.catalog,
  });
  const addonsQ = useQuery({ queryKey: qk.addons, queryFn: api.addons });
  const overview = useQuery({ queryKey: qk.stockOverview, queryFn: api.stockOverview });
  const store = useSession().store.name;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const focusId = params.get('p');
  const [kind, setKind] = useState<Kind>('produtos');
  const [filter, setFilter] = useState<Filter | null>(null);
  // from the overview's "sem custo": only counted items that have no cost yet
  const [uncosted, setUncosted] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Subject | null>(null);
  const [pricing, setPricing] = useState<Product | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const all = useMemo(() => (data?.categories ?? []).flatMap((c) => c.products), [data]);
  const addons = useMemo(() => addonsQ.data?.addons ?? [], [addonsQ.data]);
  const pCounts = useMemo(
    () => ({
      repor: all.filter((p) => p.status !== 'archived' && needs(p)).length,
      contando: all.filter((p) => p.stockQuantity != null).length,
      sem: all.filter((p) => p.stockQuantity == null && p.status !== 'archived').length,
    }),
    [all],
  );
  const aCounts = useMemo(
    () => ({
      repor: addons.filter(needsAddon).length,
      contando: addons.filter((a) => a.stockQuantity != null).length,
      sem: addons.filter((a) => a.stockQuantity == null && a.productCount > 0).length,
    }),
    [addons],
  );
  const counts = kind === 'produtos' ? pCounts : aCounts;
  // opens where there's work: what needs restocking, else what's counted, else where to start
  const shown: Filter = uncosted
    ? 'contando'
    : (filter ?? (counts.repor ? 'repor' : counts.contando ? 'contando' : 'sem'));

  // ── taps: shown at once, sent as one batch when they pause ───────────────────────────────
  const [pending, setPending] = useState<Record<string, number>>({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const adjust = useMutation({
    mutationFn: (changes: { productId: string; add: number; reason?: StockReason }[]) =>
      api.adjustStock(changes),
    onMutate: (changes) => {
      const add = new Map(changes.map((c) => [c.productId, c.add]));
      return optimistic<Catalog>(qc, qk.catalog, (d) =>
        mapProducts(d, (p) =>
          add.has(p.id) && p.stockQuantity != null
            ? withStock(p, Math.min(MAX, Math.max(0, p.stockQuantity + add.get(p.id)!)))
            : p,
        ),
      );
    },
    onSuccess: (r) => {
      // Core's numbers win over the guess (a sale may have landed in between)
      qc.setQueryData<Catalog>(qk.catalog, (d) =>
        d ? mapProducts(d, (p) => (p.id in r.stock ? withStock(p, r.stock[p.id]!) : p)) : d,
      );
      if (r.waitlistWoken)
        toast(
          r.waitlistWoken === 1
            ? 'Voltou! Avisamos 1 pessoa da lista de espera'
            : `Voltou! Avisamos ${r.waitlistWoken} pessoas da lista de espera`,
        );
    },
    onError: (e, _v, ctx) => {
      ctx?.restore();
      toast.error(`O estoque não foi salvo. ${messageOf(e)}`);
    },
    // under 'catalog': the overview and the adicionais refresh with it
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.catalog }),
  });
  const adjustAddons = useMutation({
    mutationFn: (changes: { key: string; add: number; reason?: StockReason }[]) =>
      api.adjustAddons(changes),
    onMutate: (changes) => {
      const add = new Map(changes.map((c) => [c.key, c.add]));
      return optimistic<Addons>(qc, qk.addons, (d) => ({
        ...d,
        addons: d.addons.map((a) =>
          add.has(a.key) && a.stockQuantity != null
            ? withAddonStock(a, Math.min(MAX, Math.max(0, a.stockQuantity + add.get(a.key)!)))
            : a,
        ),
      }));
    },
    onSuccess: (r) => {
      qc.setQueryData<Addons>(qk.addons, (d) =>
        d
          ? {
              ...d,
              addons: d.addons.map((a) =>
                a.key in r.stock ? withAddonStock(a, r.stock[a.key]!) : a,
              ),
            }
          : d,
      );
    },
    onError: (e, _v, ctx) => {
      ctx?.restore();
      toast.error(`O estoque não foi salvo. ${messageOf(e)}`);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.addons });
      void qc.invalidateQueries({ queryKey: qk.stockOverview });
    },
  });
  // what's still on its way: an absolute count waits for it, or the taps would land after it
  const inflight = useRef(new Set<Promise<unknown>>());
  const track = (p: Promise<unknown>) => {
    inflight.current.add(p);
    void p.finally(() => inflight.current.delete(p));
  };
  const run = (changes: Change[]) => {
    const reason = (c: Change) => (c.reason ? { reason: c.reason } : {});
    const ps = changes
      .filter((c) => c.sk.startsWith('p:'))
      .map((c) => ({ productId: c.sk.slice(2), add: c.add, ...reason(c) }));
    const as = changes
      .filter((c) => c.sk.startsWith('a:'))
      .map((c) => ({ key: c.sk.slice(2), add: c.add, ...reason(c) }));
    if (ps.length) track(adjust.mutateAsync(ps).catch(() => undefined));
    if (as.length) track(adjustAddons.mutateAsync(as).catch(() => undefined));
  };
  const send = useRef(run);
  send.current = run;

  const flush = () => {
    clearTimeout(timer.current);
    const changes = Object.entries(pendingRef.current)
      .filter(([, add]) => add !== 0)
      .map(([sk, add]) => ({ sk, add }));
    pendingRef.current = {};
    setPending({});
    if (changes.length) send.current(changes);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const tap = (sk: string, by: number) => {
    haptic.tick();
    setPending((s) => {
      const next = { ...s, [sk]: (s[sk] ?? 0) + by };
      pendingRef.current = next;
      return next;
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), FLUSH_MS);
  };

  // leaving the screen or the app sends what's waiting
  useEffect(() => {
    const hide = () => document.visibilityState === 'hidden' && flushRef.current();
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      flushRef.current();
    };
  }, []);

  const countOf = (sk: string, n: number | null) =>
    Math.min(MAX, Math.max(0, (n ?? 0) + (pending[sk] ?? 0)));

  // a row stays in its tab while you work on it, even once it no longer matches
  const kept = useRef({ key: '', ids: new Set<string>() });
  const matches = (c: Counted & { archived: boolean; offered: boolean; needs: boolean }) => {
    if (uncosted) return c.stockQuantity != null && c.costCents == null;
    if (shown === 'repor') return !c.archived && c.needs;
    if (shown === 'contando') return c.stockQuantity != null;
    return c.stockQuantity == null && !c.archived && c.offered;
  };
  const needle = q.trim().toLocaleLowerCase('pt-BR');
  const keepKey = `${kind}|${shown}|${uncosted}|${needle}`;
  if (kept.current.key !== keepKey) kept.current = { key: keepKey, ids: new Set() };
  const keep = (sk: string, name: string, ok: boolean) => {
    if (needle && !name.toLocaleLowerCase('pt-BR').includes(needle)) return false;
    if (ok) {
      kept.current.ids.add(sk);
      return true;
    }
    return kept.current.ids.has(sk);
  };
  const groups =
    kind === 'produtos'
      ? (data?.categories ?? [])
          .map((c) => ({
            c,
            rows: c.products.filter((p) =>
              keep(
                `p:${p.id}`,
                p.name,
                matches({
                  ...p,
                  archived: p.status === 'archived',
                  offered: true,
                  needs: needs(p),
                }),
              ),
            ),
          }))
          .filter((g) => g.rows.length)
      : [];
  const addonRows =
    kind === 'adicionais'
      ? addons.filter((a) =>
          keep(
            `a:${a.key}`,
            a.name,
            matches({ ...a, archived: false, offered: a.productCount > 0, needs: needsAddon(a) }),
          ),
        )
      : [];

  // the shopping list: every counted item at 0 or in its aviso
  const sold = overview.data?.sold7d;
  const restock = useMemo<Restock[]>(() => {
    const item = (sk: string, c: Counted, soldN: number | undefined): Restock => {
      const now = c.stockQuantity ?? 0;
      const t = c.lowStockThreshold;
      return {
        sk,
        name: c.name,
        now,
        sold: soldN ?? null,
        suggest: Math.max(1, (soldN ?? 0) - now, t ? t * 2 - now : 0),
      };
    };
    return [
      ...all
        .filter((p) => p.status !== 'archived' && needs(p))
        .map((p) => item(`p:${p.id}`, p, sold?.products[p.id])),
      ...addons.filter(needsAddon).map((a) => item(`a:${a.key}`, a, sold?.addons[a.key])),
    ];
  }, [all, addons, sold]);

  // from Início's "só 2 no estoque": open on that product and point at it
  useEffect(() => {
    if (!focusId || !data) return;
    const p = all.find((x) => x.id === focusId);
    setParams({}, { replace: true });
    if (!p) return;
    setKind('produtos');
    setUncosted(false);
    setFilter(p.stockQuantity == null ? 'sem' : needs(p) ? 'repor' : 'contando');
    setFlash(`p:${p.id}`);
  }, [focusId, data, all, setParams]);
  useEffect(() => {
    if (!flash) return;
    document.getElementById(`stock-${flash}`)?.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(t);
  }, [flash]);

  const contando = pCounts.contando + aCounts.contando;
  const repor = pCounts.repor + aCounts.repor;
  const subtitle = data
    ? contando
      ? `${[
          pCounts.contando
            ? `${pCounts.contando} ${pCounts.contando === 1 ? 'produto' : 'produtos'}`
            : '',
          aCounts.contando
            ? `${aCounts.contando} ${aCounts.contando === 1 ? 'adicional' : 'adicionais'}`
            : '',
        ]
          .filter(Boolean)
          .join(' e ')} contando${repor ? ` · ${repor} para repor` : ''}`
      : 'Nada contando estoque ainda'
    : undefined;

  const switchKind = (k: Kind) => {
    if (k === kind) return;
    haptic.tick();
    flush();
    setKind(k);
    setFilter(null);
    setUncosted(false);
    setQ('');
  };
  const showUncosted = () => {
    flush();
    const p = all.some((x) => x.stockQuantity != null && x.costCents == null);
    setKind(p ? 'produtos' : 'adicionais');
    setFilter('contando');
    setUncosted(true);
    setQ('');
  };
  const edit = (s: Subject) => {
    flush();
    setEditing(s);
  };
  const total = kind === 'produtos' ? all.length : addons.length;
  const noun = kind === 'produtos' ? 'produto' : 'adicional';

  return (
    <PageBody>
      <PageHeader title="Estoque" back="/cardapio" subtitle={subtitle} />

      {error && !data ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : isPending ? (
        <div className="space-y-4">
          <ChipsSkeleton count={3} />
          <RowsSkeleton rows={6} />
        </div>
      ) : !all.length ? (
        <EmptyState
          art={<Mascote pose="catalogo" />}
          title="Nenhum produto ainda"
          body="Crie seus produtos no Cardápio. Depois você conta o estoque deles aqui."
          action={<ButtonLink to="/cardapio">ir para o Cardápio</ButtonLink>}
        />
      ) : (
        <>
          {overview.data ? (
            <Overview
              ov={overview.data}
              restock={restock.length}
              onList={() => {
                flush();
                setListOpen(true);
              }}
              onUncosted={showUncosted}
            />
          ) : null}

          <div role="tablist" aria-label="o que contar" className="mb-3 flex gap-2">
            {(
              [
                ['produtos', 'Produtos'],
                ['adicionais', 'Adicionais'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => switchKind(k)}
                className={cn(
                  'press t-label min-h-11 rounded-full px-4 ring-1 transition-[color,background-color] duration-(--duration-quick)',
                  kind === k
                    ? 'bg-primary text-on-primary ring-primary'
                    : 'bg-surface text-ink ring-line-strong hover:bg-hover',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {kind === 'adicionais' && addonsQ.error && !addonsQ.data ? (
            <ErrorState error={addonsQ.error} retry={() => void addonsQ.refetch()} />
          ) : kind === 'adicionais' && addonsQ.isPending ? (
            <div className="space-y-4">
              <ChipsSkeleton count={3} />
              <RowsSkeleton rows={4} avatar={false} />
            </div>
          ) : kind === 'adicionais' && !addons.length ? (
            <EmptyState
              art={<Mascote pose="catalogo" />}
              title="Nenhum adicional pago ainda"
              body="Adicionais como “Bacon extra” aparecem aqui quando um produto tem opções com preço."
              action={<ButtonLink to="/cardapio">ir para o Cardápio</ButtonLink>}
            />
          ) : (
            <>
              <Segmented
                label="mostrar"
                value={shown}
                onChange={(v) => {
                  flush();
                  setUncosted(false);
                  setFilter(v);
                }}
                className="mb-4"
                options={[
                  { value: 'repor', label: 'Para repor', count: counts.repor },
                  { value: 'contando', label: 'Contando', count: counts.contando },
                  { value: 'sem', label: 'Sem contar', count: counts.sem },
                ]}
              />
              {total > 8 ? (
                <div className="mb-4">
                  <TextInput
                    type="search"
                    aria-label={`buscar ${noun}`}
                    placeholder={kind === 'produtos' ? 'Buscar produto' : 'Buscar adicional'}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    lead={<MagnifyingGlass className="size-5" />}
                  />
                </div>
              ) : null}
              {uncosted ? (
                <div className="mb-5 flex items-center gap-3 rounded-md bg-spark-soft py-1.5 pl-4 pr-1.5">
                  <p className="t-body min-w-0 flex-1">
                    Só os que estão sem custo. Toque no número e ponha quanto custa cada um.
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-11 shrink-0"
                    onClick={() => setUncosted(false)}
                  >
                    ver todos
                  </Button>
                </div>
              ) : kind === 'produtos' ? (
                <Hint id="stock-screen" className="mb-5">
                  Cada venda desconta sozinha. Quando chega a zero, o produto aparece como esgotado
                  na loja. Toque no número para digitar uma contagem ou o que chegou.
                </Hint>
              ) : (
                <Hint id="stock-addons" className="mb-5">
                  Um adicional com o mesmo nome em vários produtos tem um estoque só. Cada pedido
                  desconta sozinho e, no zero, ele aparece como esgotado em todos.
                </Hint>
              )}

              {kind === 'produtos' ? (
                !groups.length ? (
                  <Empty
                    kind={kind}
                    shown={shown}
                    q={q}
                    uncosted={uncosted}
                    onSem={() => setFilter('sem')}
                  />
                ) : (
                  <div className="space-y-6">
                    {groups.map(({ c, rows }) => (
                      <section key={c.id} aria-labelledby={`stock-cat-${c.id}`}>
                        <h2 id={`stock-cat-${c.id}`} className="t-label mb-2 px-1 text-muted">
                          {c.name}
                        </h2>
                        <Card className="divide-y divide-line overflow-hidden">
                          {rows.map((p) => {
                            const sk = `p:${p.id}`;
                            return (
                              <StockRow
                                key={p.id}
                                p={p}
                                count={countOf(sk, p.stockQuantity)}
                                dirty={!!pending[sk]}
                                flash={flash === sk}
                                onTap={(by) => tap(sk, by)}
                                onEdit={() => edit({ type: 'product', p })}
                              />
                            );
                          })}
                        </Card>
                      </section>
                    ))}
                  </div>
                )
              ) : !addonRows.length ? (
                <Empty
                  kind={kind}
                  shown={shown}
                  q={q}
                  uncosted={uncosted}
                  onSem={() => setFilter('sem')}
                />
              ) : (
                <Card className="divide-y divide-line overflow-hidden">
                  {addonRows.map((a) => {
                    const sk = `a:${a.key}`;
                    return (
                      <AddonRow
                        key={a.key}
                        a={a}
                        count={countOf(sk, a.stockQuantity)}
                        dirty={!!pending[sk]}
                        onTap={(by) => tap(sk, by)}
                        onEdit={() => edit({ type: 'addon', a })}
                      />
                    );
                  })}
                </Card>
              )}
            </>
          )}
        </>
      )}

      <CountSheet
        s={editing}
        costFirst={uncosted}
        onClose={() => setEditing(null)}
        onAdd={(s, add, reason) => run([{ sk: skOf(s), add, reason }])}
        settled={() => Promise.all([...inflight.current])}
        onPricing={(p) => {
          setEditing(null);
          // after the count sheet's history entry is gone, or its back-pop closes this one too
          setTimeout(() => setPricing(p), 320);
        }}
      />
      <PricingSheet product={pricing} onClose={() => setPricing(null)} />
      <ShoppingSheet
        open={listOpen}
        items={restock}
        store={store}
        onClose={() => setListOpen(false)}
      />
    </PageBody>
  );
}

function Empty({
  kind,
  shown,
  q,
  uncosted,
  onSem,
}: {
  kind: Kind;
  shown: Filter;
  q: string;
  uncosted: boolean;
  onSem: () => void;
}) {
  const products = kind === 'produtos';
  if (q.trim())
    return (
      <EmptyState
        art={<Mascote pose="sem-resultados" />}
        title={`Nenhum ${products ? 'produto' : 'adicional'} com “${q.trim()}”`}
        body="Confira se está escrito certo, ou procure em outra aba."
      />
    );
  if (uncosted)
    return (
      <DuaNote pose="sucesso" title="Tudo com custo">
        {products
          ? 'Todos os produtos que contam estoque já têm custo.'
          : 'Todos os adicionais que contam estoque já têm custo.'}
      </DuaNote>
    );
  if (shown === 'repor')
    return (
      <DuaNote pose="sucesso" title="Nada para repor agora">
        {products
          ? 'Quando um produto acabar ou chegar no aviso de estoque baixo, ele aparece aqui.'
          : 'Quando um adicional acabar ou chegar no aviso de estoque baixo, ele aparece aqui.'}
      </DuaNote>
    );
  if (shown === 'contando')
    return (
      <DuaNote
        pose="catalogo"
        title={products ? 'Nenhum produto contando estoque' : 'Nenhum adicional contando estoque'}
        action={
          <Button size="sm" variant="secondary" onClick={onSem}>
            {products ? 'ver produtos sem contar' : 'ver adicionais sem contar'}
          </Button>
        }
      >
        {products
          ? 'Faz sob encomenda? Não precisa contar. Se tem uma quantidade certa, comece por lá.'
          : 'Conte o que pode acabar, como bacon ou queijo extra. No zero, ele aparece esgotado em todos os produtos.'}
      </DuaNote>
    );
  return (
    <DuaNote
      pose="sucesso"
      title={
        products ? 'Todos os produtos já contam estoque' : 'Todos os adicionais já contam estoque'
      }
    />
  );
}

/** What the stock is worth (Core's sum) and the way to the shopping list. */
function Overview({
  ov,
  restock,
  onList,
  onUncosted,
}: {
  ov: StockOverview;
  restock: number;
  onList: () => void;
  onUncosted: () => void;
}) {
  if (!ov.costedItems && !ov.uncostedItems && !restock) return null;
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 pl-4 pr-3">
      <div className="min-w-0 flex-1 py-0.5">
        {ov.costedItems ? (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="t-caption text-muted">Valor em estoque</span>
            <span className="tnum text-[1.125rem] font-bold">{money(ov.valueCents)}</span>
          </p>
        ) : (
          <p className="t-caption text-muted">
            Com o custo de cada item, você vê quanto vale o estoque.
          </p>
        )}
        {ov.uncostedItems ? (
          <button
            type="button"
            onClick={onUncosted}
            className="press t-caption -ml-1.5 flex min-h-9 items-center whitespace-nowrap rounded-sm px-1.5 hover:bg-hover"
          >
            <span className="tnum font-semibold text-warning">
              {num(ov.uncostedItems)} sem custo
            </span>
            <span className="text-muted">&nbsp;·&nbsp;</span>
            <span className="font-semibold text-primary">pôr custo</span>
          </button>
        ) : null}
      </div>
      {restock ? (
        <Button
          size="sm"
          variant="secondary"
          icon={<ListChecks />}
          className="h-11 shrink-0"
          onClick={onList}
        >
          lista de compras
        </Button>
      ) : null}
    </Card>
  );
}

/** − count + for a counted item, or "contar" for one that isn't */
function Counter({
  name,
  tracked,
  count,
  out,
  low,
  dirty,
  onTap,
  onEdit,
}: {
  name: string;
  tracked: boolean;
  count: number;
  out: boolean;
  low: boolean;
  dirty: boolean;
  onTap: (by: number) => void;
  onEdit: () => void;
}) {
  if (!tracked)
    return (
      <Button
        size="sm"
        variant="secondary"
        className="h-11 shrink-0"
        onClick={onEdit}
        aria-label={`contar estoque de ${name}`}
      >
        contar
      </Button>
    );
  return (
    <div
      role="group"
      aria-label={`estoque de ${name}`}
      className="flex shrink-0 items-center rounded-full bg-sunken p-0.5"
    >
      <button
        type="button"
        aria-label={`tirar 1 de ${name}`}
        disabled={count <= 0}
        onClick={() => onTap(-1)}
        className="press grid size-11 place-items-center rounded-full hover:bg-press active:bg-press disabled:opacity-35"
      >
        <Minus weight="bold" className="size-4.5" />
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`${count} em estoque de ${name}. Digitar quantidade`}
        className={cn(
          'press tnum h-11 min-w-12 rounded-full px-1.5 text-center text-[1.125rem] font-bold tabular-nums hover:bg-press',
          out ? 'text-danger' : low ? 'text-warning' : 'text-ink',
          dirty && 'text-primary',
        )}
      >
        <span aria-live="polite">{count}</span>
      </button>
      <button
        type="button"
        aria-label={`pôr mais 1 de ${name}`}
        disabled={count >= MAX}
        onClick={() => onTap(1)}
        className="press grid size-11 place-items-center rounded-full hover:bg-press active:bg-press disabled:opacity-35"
      >
        <Plus weight="bold" className="size-4.5" />
      </button>
    </div>
  );
}

function stockStatus(
  tracked: boolean,
  out: boolean,
  low: boolean,
  threshold: number | null,
  waiting = 0,
): ReactNode {
  if (!tracked) return <span className="text-muted">não conta estoque</span>;
  if (out)
    return (
      <span className="font-semibold text-danger">
        acabou{waiting ? ` · ${waiting} na espera` : ''}
      </span>
    );
  if (low) return <span className="font-semibold text-warning">pouco · aviso com {threshold}</span>;
  return (
    <span className="text-muted">{threshold != null ? `aviso com ${threshold}` : 'sem aviso'}</span>
  );
}

function StockRow({
  p,
  count,
  dirty,
  flash,
  onTap,
  onEdit,
}: {
  p: Product;
  count: number;
  dirty: boolean;
  flash: boolean;
  onTap: (by: number) => void;
  onEdit: () => void;
}) {
  const preload = usePreload();
  const tracked = p.stockQuantity != null;
  const out = tracked && count === 0;
  const low = tracked && isLow(count, p.lowStockThreshold);
  const href = `/cardapio/produto/${p.id}`;
  const extra =
    p.status === 'archived' ? 'escondido' : p.status === 'sold_out' ? 'marcado esgotado' : null;

  return (
    <div
      id={`stock-p:${p.id}`}
      className={cn(
        'flex min-h-18 scroll-mt-24 items-center gap-3 px-3 py-2.5 transition-[background-color] duration-(--duration-smooth) sm:px-4',
        flash && 'bg-spark-soft',
      )}
    >
      <Link
        to={href}
        {...preload(href)}
        className="press flex min-w-0 flex-1 items-center gap-3 self-stretch"
      >
        <span
          data-vt-src={`product:${p.id}`}
          className={cn(
            'size-11 shrink-0 overflow-hidden rounded-sm bg-sunken max-sm:hidden',
            out && 'grayscale',
            p.status === 'archived' && 'opacity-50',
          )}
          style={p.dominant ? { background: p.dominant } : undefined}
        >
          {p.imageUrl ? (
            <img src={p.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 py-1">
          <span className="line-clamp-2 font-semibold leading-snug">{p.name}</span>
          <span className="t-caption mt-0.5 block">
            {stockStatus(tracked, out, low, p.lowStockThreshold, p.waiting)}
            {extra ? <span className="text-muted"> · {extra}</span> : null}
          </span>
        </span>
      </Link>
      <Counter
        name={p.name}
        tracked={tracked}
        count={count}
        out={out}
        low={low}
        dirty={dirty}
        onTap={onTap}
        onEdit={onEdit}
      />
    </div>
  );
}

function AddonRow({
  a,
  count,
  dirty,
  onTap,
  onEdit,
}: {
  a: Addon;
  count: number;
  dirty: boolean;
  onTap: (by: number) => void;
  onEdit: () => void;
}) {
  const tracked = a.stockQuantity != null;
  const out = tracked && count === 0;
  const low = tracked && isLow(count, a.lowStockThreshold);
  return (
    <div id={`stock-a:${a.key}`} className="flex min-h-18 items-center gap-3 px-3 py-2.5 sm:px-4">
      <div className="min-w-0 flex-1 py-1">
        <p className="line-clamp-2 font-semibold leading-snug">{a.name}</p>
        <p className="t-caption mt-0.5">
          {stockStatus(tracked, out, low, a.lowStockThreshold)}
          {!tracked && a.status === 'sold_out' ? (
            <span className="text-muted"> · marcado esgotado</span>
          ) : null}
        </p>
        <p className="t-caption truncate text-muted">
          {a.priceDeltaCents ? <span className="tnum">+{money(a.priceDeltaCents)} · </span> : null}
          {a.productCount ? usedIn(a) : 'não é mais oferecido'}
        </p>
      </div>
      <Counter
        name={a.name}
        tracked={tracked}
        count={count}
        out={out}
        low={low}
        dirty={dirty}
        onTap={onTap}
        onEdit={onEdit}
      />
    </div>
  );
}

type Mode = 'chegou' | 'contei' | 'perdi';

function CountSheet({
  s: open,
  costFirst,
  onClose,
  onAdd,
  settled,
  onPricing,
}: {
  s: Subject | null;
  /** opened from "sem custo": the cost is what they came for */
  costFirst: boolean;
  onClose: () => void;
  onAdd: (s: Subject, add: number, reason: StockReason) => void;
  settled: () => Promise<unknown>;
  onPricing: (p: Product) => void;
}) {
  const qc = useQueryClient();
  // the last item stays while the sheet slides away
  const [s, setS] = useState(open);
  if (open && open !== s) setS(open);
  const v = s ? view(s) : null;
  const tracked = v?.stockQuantity != null;
  const [mode, setMode] = useState<Mode>('chegou');
  const [value, setValue] = useState('');
  const [threshold, setThreshold] = useState(0);
  const [cost, setCost] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [costErr, setCostErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const o = view(open);
    setMode(o.stockQuantity == null ? 'contei' : 'chegou');
    setValue('');
    setThreshold(o.lowStockThreshold ?? 0);
    setCost(moneyInput(o.costCents));
    setErr(null);
    setCostErr(null);
  }, [open]);

  const saveProduct = useMutation({
    mutationFn: (x: { id: string; patch: Patch }) => api.updateProduct(x.id, x.patch),
    onSuccess: (r) => {
      qc.setQueryData<Catalog>(qk.catalog, (d) =>
        d ? mapProducts(d, (x) => (x.id === r.product.id ? { ...x, ...r.product } : x)) : d,
      );
      qc.setQueryData<Awaited<ReturnType<typeof api.product>>>(qk.product(r.product.id), (d) => ({
        pricingDefaults: null,
        ...d,
        product: r.product,
      }));
      void qc.invalidateQueries({ queryKey: qk.catalog });
    },
  });
  const saveAddon = useMutation({
    mutationFn: (body: Patch & { key: string }) => api.updateAddon(body),
    onSuccess: (r) => {
      qc.setQueryData<Addons>(qk.addons, (d) =>
        d ? { ...d, addons: d.addons.map((a) => (a.key === r.addon.key ? r.addon : a)) } : d,
      );
      void qc.invalidateQueries({ queryKey: qk.addons });
      void qc.invalidateQueries({ queryKey: qk.stockOverview });
    },
  });
  const saving = saveProduct.isPending || saveAddon.isPending;
  /** → people woken from the waiting list */
  const write = async (x: Subject, patch: Patch) =>
    x.type === 'product'
      ? (await saveProduct.mutateAsync({ id: x.p.id, patch })).waitlistWoken
      : (await saveAddon.mutateAsync({ key: x.a.key, ...patch }), 0);

  if (!s || !v) return null;

  const product = s.type === 'product' ? s.p : null;
  // a product priced in the calculator keeps its cost there
  const costLocked = !!product?.pricing;
  const n = value.trim() === '' ? null : Number(value);
  const valid = n !== null && Number.isInteger(n) && n >= 0 && n <= MAX;
  const now = v.stockQuantity ?? 0;
  const result = !valid
    ? null
    : mode === 'chegou'
      ? Math.min(MAX, now + n!)
      : mode === 'perdi'
        ? Math.max(0, now - n!)
        : n!;
  const thresholdChanged = tracked && threshold !== (v.lowStockThreshold ?? 0);
  const costCents = cost.trim() ? parseMoney(cost) : null;
  const costBad = !!cost.trim() && costCents === null;
  const costChanged = !costLocked && !costBad && costCents !== (v.costCents ?? null);

  const submit = async () => {
    if (costBad) {
      setCostErr('Digite um valor, como 4,50.');
      return;
    }
    if (!valid && !thresholdChanged && !costChanged) {
      setErr('Digite um número, como 12.');
      input.current?.focus();
      return;
    }
    if (n !== null && !valid) {
      setErr('Use só números inteiros, de 0 em diante.');
      return;
    }
    if (valid && mode === 'perdi' && n! > now) {
      setErr(`Tem só ${now} em estoque.`);
      return;
    }
    try {
      const patch: Patch = {};
      if (valid && mode === 'contei') patch.stockQuantity = n!;
      if (thresholdChanged) patch.lowStockThreshold = threshold || null;
      if (costChanged) patch.costCents = costCents;
      let woken = 0;
      if ('stockQuantity' in patch) await settled();
      if (Object.keys(patch).length) woken = await write(s, patch);
      // a delivery or a loss is relative: the sales of the last minutes still count
      if (valid && n && mode === 'chegou') onAdd(s, n, 'delivery');
      if (valid && n && mode === 'perdi') onAdd(s, -n, 'loss');
      haptic.commit();
      toast(
        result !== null
          ? `${v.name}: ${result} em estoque${woken ? ` · avisamos ${woken} da lista de espera` : ''}`
          : thresholdChanged
            ? `${v.name}: aviso com ${threshold || 'nenhum'}`
            : `${v.name}: custo salvo`,
      );
      onClose();
    } catch (e) {
      setErr(messageOf(e));
    }
  };

  const stopCounting = async () => {
    try {
      await write(
        s,
        s.type === 'product'
          ? { stockQuantity: null, lowStockThreshold: null }
          : { stockQuantity: null },
      );
      toast(`${v.name} não conta mais estoque`);
      onClose();
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  const label =
    mode === 'chegou'
      ? 'Quantos chegaram?'
      : mode === 'perdi'
        ? 'Quantos perdeu?'
        : 'Quantos tem agora?';
  const helper =
    result !== null && tracked
      ? mode === 'chegou'
        ? `Fica com ${result} em estoque.`
        : mode === 'perdi'
          ? `Fica com ${result}. Não conta como venda.`
          : `Era ${now}, fica ${result}.`
      : mode === 'chegou'
        ? 'Somamos ao que já tem.'
        : mode === 'perdi'
          ? 'Estragou, quebrou, venceu: sai do estoque sem contar como venda.'
          : 'O número que vale a partir de agora.';

  return (
    <Sheet
      open={!!open}
      onOpenChange={(o) => !o && onClose()}
      title={v.name}
      description={
        tracked
          ? `${now} em estoque agora`
          : s.type === 'product'
            ? 'Diga quantos tem. Cada venda desconta sozinha e, no zero, ele aparece como esgotado.'
            : 'Diga quantos tem. Cada pedido com ele desconta sozinho e, no zero, ele aparece esgotado em todos os produtos.'
      }
      footer={
        <Button block size="lg" loading={saving} onClick={() => void submit()}>
          {tracked ? 'salvar' : 'começar a contar'}
        </Button>
      }
    >
      <form
        className="space-y-5 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {tracked ? (
          <Segmented
            label="o que aconteceu"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setErr(null);
              input.current?.focus();
            }}
            options={[
              { value: 'chegou', label: 'Chegou mais' },
              { value: 'contei', label: 'Contei tudo' },
              { value: 'perdi', label: 'Perdi' },
            ]}
          />
        ) : null}
        <Field label={label} htmlFor="stock-count" error={err} helper={helper}>
          <TextInput
            ref={input}
            id="stock-count"
            inputMode="numeric"
            enterKeyHint="done"
            autoFocus={!costFirst}
            placeholder={mode === 'chegou' ? 'ex.: 12' : mode === 'perdi' ? 'ex.: 2' : String(now)}
            value={value}
            aria-invalid={!!err}
            onChange={(e) => {
              setValue(e.target.value.replace(/\D/g, '').slice(0, 7));
              setErr(null);
            }}
            lead={
              tracked && mode === 'chegou' ? '+' : tracked && mode === 'perdi' ? '−' : undefined
            }
            className="tnum text-[1.375rem] font-bold"
          />
        </Field>
        {tracked && mode === 'chegou' ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="atalhos">
            {[6, 12, 24, 50].map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant="quiet"
                className="h-11 min-w-16"
                onClick={() => {
                  haptic.tick();
                  setValue(String((n ?? 0) + k));
                  setErr(null);
                }}
              >
                +{k}
              </Button>
            ))}
          </div>
        ) : null}
        {tracked ? (
          <Field
            label="Me avise quando tiver só"
            helper="Aparece em “Precisa de você” no Início e em “Para repor” aqui. 0 = sem aviso."
          >
            <div>
              <Stepper
                label="aviso de estoque baixo"
                value={threshold}
                max={1000}
                onChange={setThreshold}
              />
            </div>
          </Field>
        ) : null}

        {costLocked && product ? (
          <div className="flex items-center gap-3 rounded-md bg-sunken py-2 pl-4 pr-2">
            <div className="min-w-0 flex-1">
              <p className="t-label">Custo por unidade</p>
              <p className="t-caption text-muted">
                <span className="tnum font-semibold text-ink">{money(product.costCents ?? 0)}</span>{' '}
                · vem do cálculo de preço
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="h-11 shrink-0"
              onClick={() => onPricing(product)}
            >
              calcular preço
            </Button>
          </div>
        ) : (
          <Field
            label="Custo por unidade"
            optional
            htmlFor="stock-cost"
            error={costErr}
            helper="Quanto você paga por um. Entra no valor do estoque."
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="w-40">
                <TextInput
                  id="stock-cost"
                  lead="R$"
                  inputMode="decimal"
                  enterKeyHint="done"
                  autoFocus={costFirst}
                  placeholder="0,00"
                  value={cost}
                  aria-invalid={!!costErr}
                  onChange={(e) => {
                    setCost(e.target.value.slice(0, 14));
                    setCostErr(null);
                  }}
                  onBlur={() => costCents !== null && setCost(moneyInput(costCents))}
                  className="tnum"
                />
              </div>
              {product ? (
                <Button variant="ghost" className="text-primary" onClick={() => onPricing(product)}>
                  quanto cobrar? calcular preço
                </Button>
              ) : null}
            </div>
          </Field>
        )}

        {tracked ? (
          <Button
            type="button"
            variant="ghost"
            className="-ml-3 text-muted"
            onClick={() => void stopCounting()}
          >
            {s.type === 'product'
              ? 'parar de contar o estoque deste produto'
              : 'parar de contar este adicional'}
          </Button>
        ) : null}
      </form>
      {tracked ? <History key={skOf(s)} s={s} /> : null}
    </Sheet>
  );
}

const REASON: Record<Exclude<StockMovement['reason'], 'sale' | 'cancel'>, string> = {
  delivery: 'Chegou',
  count: 'Contagem',
  adjust: 'Ajuste',
  loss: 'Perda',
  start: 'Começou a contar',
  stop: 'Parou de contar',
};

/** Every move of one count, newest first, 30 at a time — only fetched once opened. */
function History({ s }: { s: Subject }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const list = useInfiniteQuery({
    queryKey: qk.stockMoves(skOf(s)),
    queryFn: ({ pageParam }) =>
      api.stockMovements(
        s.type === 'product' ? { productId: s.p.id } : { addonKey: s.a.key },
        pageParam || undefined,
      ),
    initialPageParam: '',
    getNextPageParam: (p) => p.next ?? undefined,
    enabled: open,
  });
  const rows = list.data?.pages.flatMap((p) => p.movements) ?? [];

  return (
    <section className="mt-6 border-t border-line pt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((o) => !o)}
        className="press -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-2 rounded-sm px-2 text-left hover:bg-hover"
      >
        <ClockCounterClockwise className="size-5 shrink-0 text-muted" aria-hidden />
        <span className="t-label flex-1">Histórico</span>
        <CaretDown
          className={cn('size-5 shrink-0 text-muted transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      <div id={panel} hidden={!open}>
        {!open ? null : list.isPending ? (
          <RowsSkeleton rows={3} avatar={false} />
        ) : list.error && !rows.length ? (
          <p className="t-body py-2 text-muted">
            Não deu para abrir o histórico.{' '}
            <button
              type="button"
              className="font-semibold text-primary"
              onClick={() => void list.refetch()}
            >
              tentar de novo
            </button>
          </p>
        ) : !rows.length ? (
          <p className="t-body py-2 text-muted">Nada registrado ainda.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((m) => (
              <MoveRow key={m.id} m={m} />
            ))}
          </ul>
        )}
        {open && list.hasNextPage ? (
          <Button
            variant="ghost"
            block
            className="mt-1"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            ver mais
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function MoveRow({ m }: { m: StockMovement }) {
  const what =
    (m.reason === 'sale' || m.reason === 'cancel') && m.order ? (
      <Link
        to={`/pedidos/${m.order.id}`}
        className="underline decoration-line-strong underline-offset-4"
      >
        {m.reason === 'sale' ? 'Venda' : 'Cancelado'} #{m.order.number}
      </Link>
    ) : m.reason === 'sale' ? (
      'Venda'
    ) : m.reason === 'cancel' ? (
      'Cancelado'
    ) : (
      REASON[m.reason]
    );
  return (
    <li className="flex min-h-14 items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-snug">{what}</p>
        <p className="t-caption truncate text-muted">
          <time dateTime={m.at} title={when(m.at)}>
            {ago(m.at)}
          </time>
          {m.by ? ` · ${m.by}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {m.delta ? (
          <p className={cn('tnum font-bold', m.delta > 0 ? 'text-success' : 'text-ink')}>
            {m.delta > 0 ? `+${num(m.delta)}` : `−${num(-m.delta)}`}
          </p>
        ) : null}
        {m.after !== null ? <p className="tnum t-caption text-muted">fica {num(m.after)}</p> : null}
      </div>
    </li>
  );
}

type Restock = {
  sk: string;
  name: string;
  now: number;
  /** units sold in the last 7 days; null = unknown */
  sold: number | null;
  suggest: number;
};

/** What's at 0 or in its aviso, as a list to copy or send to whoever supplies it. No money. */
function ShoppingSheet({
  open,
  items,
  store,
  onClose,
}: {
  open: boolean;
  items: Restock[];
  store: string;
  onClose: () => void;
}) {
  const [picks, setPicks] = useState<Record<string, { on: boolean; qty: number }>>({});
  useEffect(() => {
    if (open) setPicks({});
  }, [open]);
  const pick = (i: Restock) => picks[i.sk] ?? { on: true, qty: i.suggest };
  const set = (i: Restock, patch: Partial<{ on: boolean; qty: number }>) =>
    setPicks((ps) => ({ ...ps, [i.sk]: { ...pick(i), ...patch } }));
  const chosen = items.filter((i) => pick(i).on);
  const text = [
    `Lista de compras${store ? ` — ${store}` : ''}`,
    ...chosen.map((i) => `• ${pick(i).qty} × ${i.name}`),
  ].join('\n');
  const products = items.filter((i) => i.sk.startsWith('p:'));
  const addons = items.filter((i) => i.sk.startsWith('a:'));

  const group = (title: string, list: Restock[]) =>
    list.length ? (
      <section aria-label={title}>
        <h3 className="t-label mb-1 text-muted">{title}</h3>
        <ul className="divide-y divide-line">
          {list.map((i) => {
            const { on, qty } = pick(i);
            return (
              <li key={i.sk} className="flex min-h-16 items-center gap-2 py-1.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`${i.name} na lista`}
                  onClick={() => {
                    haptic.tick();
                    set(i, { on: !on });
                  }}
                  className="press -ml-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-press"
                >
                  {on ? (
                    <CheckSquare weight="fill" className="size-7 text-ink" />
                  ) : (
                    <Square weight="bold" className="size-7 text-muted" />
                  )}
                </button>
                <div className={cn('min-w-0 flex-1', !on && 'opacity-50')}>
                  <p className="line-clamp-2 font-semibold leading-snug">{i.name}</p>
                  <p className="t-caption text-muted">
                    {i.now === 0 ? (
                      <span className="font-semibold text-danger">acabou</span>
                    ) : (
                      <span className="font-semibold text-warning">tem {num(i.now)}</span>
                    )}
                    {i.sold ? ` · vendeu ${num(i.sold)} em 7 dias` : ''}
                  </p>
                </div>
                <div className={cn('shrink-0', !on && 'opacity-50')}>
                  <Stepper
                    label={`quantos comprar de ${i.name}`}
                    value={qty}
                    min={1}
                    max={9999}
                    onChange={(q) => set(i, { qty: q, on: true })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    ) : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Lista de compras"
      description="O que acabou ou chegou no aviso. Ajuste as quantidades e mande para quem fornece."
      footer={
        <div className="flex flex-col gap-2">
          <a
            href={chosen.length ? `https://wa.me/?text=${encodeURIComponent(text)}` : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!chosen.length || undefined}
            className={cn(
              'press t-label inline-flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-whatsapp px-6 text-[1rem] text-on-whatsapp depth-1',
              !chosen.length && 'pointer-events-none opacity-45',
            )}
          >
            <WhatsappLogo weight="fill" className="size-6" /> enviar no WhatsApp
          </a>
          <Button
            block
            variant="secondary"
            icon={<Copy />}
            disabled={!chosen.length}
            onClick={() =>
              void copyText(text).then((ok) =>
                ok ? toast('Lista copiada') : toast.error('Não deu para copiar. Tente o WhatsApp.'),
              )
            }
          >
            copiar lista
          </Button>
        </div>
      }
    >
      {items.length ? (
        <div className="space-y-5 pt-1">
          {group('Produtos', products)}
          {group('Adicionais', addons)}
        </div>
      ) : (
        <p className="t-body py-4 text-muted">Nada para repor agora.</p>
      )}
    </Sheet>
  );
}
