import { MagnifyingGlass, Minus, Plus } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePreload } from '../../app/routes.ts';
import { api, type Category, type Product } from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { DuaNote, EmptyState, ErrorState, Hint, messageOf } from '../../ui/feedback.tsx';
import { Field, Segmented, Stepper, TextInput } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { ChipsSkeleton, RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';

// Every product's count on one screen: − and + for the day-to-day, a tap on the number to type
// a count or a delivery. Taps go to Core as relative changes, batched once the finger pauses,
// so a sale drawn meanwhile is never overwritten by what this screen saw.

type Filter = 'repor' | 'contando' | 'sem';
type Catalog = { categories: Category[] };

const MAX = 1_000_000;
const FLUSH_MS = 700;

// Core's own rules (modules/catalog.ts): stock 0 reads sold out; low is 1..threshold
const isLow = (n: number, threshold: number | null) => n > 0 && threshold != null && n <= threshold;
const needs = (p: Product) => p.stockQuantity != null && (p.stockQuantity === 0 || p.lowStock);

function withStock(p: Product, n: number): Product {
  return {
    ...p,
    stockQuantity: n,
    lowStock: isLow(n, p.lowStockThreshold),
    liveStatus: p.status === 'active' ? (n === 0 ? 'sold_out' : 'active') : p.liveStatus,
  };
}

const mapProducts = (d: Catalog, fn: (p: Product) => Product): Catalog => ({
  ...d,
  categories: d.categories.map((c) => ({ ...c, products: c.products.map(fn) })),
});

export default function Stock() {
  const { data, error, refetch, isPending } = useQuery({
    queryKey: qk.catalog,
    queryFn: api.catalog,
  });
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const focusId = params.get('p');
  const [filter, setFilter] = useState<Filter | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const all = useMemo(() => (data?.categories ?? []).flatMap((c) => c.products), [data]);
  const counts = useMemo(
    () => ({
      repor: all.filter((p) => p.status !== 'archived' && needs(p)).length,
      contando: all.filter((p) => p.stockQuantity != null).length,
      sem: all.filter((p) => p.stockQuantity == null && p.status !== 'archived').length,
    }),
    [all],
  );
  // opens where there's work: what needs restocking, else what's counted, else where to start
  const shown: Filter = filter ?? (counts.repor ? 'repor' : counts.contando ? 'contando' : 'sem');

  // ── taps: shown at once, sent as one batch when they pause ───────────────────────────────
  const [pending, setPending] = useState<Record<string, number>>({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const adjust = useMutation({
    mutationFn: (changes: { productId: string; add: number }[]) => api.adjustStock(changes),
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
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.catalog }),
  });
  // what's still on its way: an absolute count waits for it, or the taps would land after it
  const inflight = useRef(new Set<Promise<unknown>>());
  const run = (changes: { productId: string; add: number }[]) => {
    const p = adjust.mutateAsync(changes).catch(() => undefined);
    inflight.current.add(p);
    void p.finally(() => inflight.current.delete(p));
  };
  const send = useRef(run);
  send.current = run;

  const flush = () => {
    clearTimeout(timer.current);
    const changes = Object.entries(pendingRef.current)
      .filter(([, add]) => add !== 0)
      .map(([productId, add]) => ({ productId, add }));
    pendingRef.current = {};
    setPending({});
    if (changes.length) send.current(changes);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const tap = (p: Product, by: number) => {
    haptic.tick();
    setPending((s) => {
      const next = { ...s, [p.id]: (s[p.id] ?? 0) + by };
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

  const countOf = (p: Product) =>
    Math.min(MAX, Math.max(0, (p.stockQuantity ?? 0) + (pending[p.id] ?? 0)));

  // a row stays in its tab while you work on it, even once it no longer matches
  const kept = useRef({ key: '', ids: new Set<string>() });
  const matches = (p: Product) => {
    if (shown === 'repor') return p.status !== 'archived' && needs(p);
    if (shown === 'contando') return p.stockQuantity != null;
    return p.stockQuantity == null && p.status !== 'archived';
  };
  const needle = q.trim().toLocaleLowerCase('pt-BR');
  if (kept.current.key !== `${shown}|${needle}`)
    kept.current = { key: `${shown}|${needle}`, ids: new Set() };
  const groups = (data?.categories ?? [])
    .map((c) => ({
      c,
      rows: c.products.filter((p) => {
        if (needle && !p.name.toLocaleLowerCase('pt-BR').includes(needle)) return false;
        if (matches(p)) {
          kept.current.ids.add(p.id);
          return true;
        }
        return kept.current.ids.has(p.id);
      }),
    }))
    .filter((g) => g.rows.length);

  // from Início's "só 2 no estoque": open on that product and point at it
  useEffect(() => {
    if (!focusId || !data) return;
    const p = all.find((x) => x.id === focusId);
    setParams({}, { replace: true });
    if (!p) return;
    setFilter(p.stockQuantity == null ? 'sem' : needs(p) ? 'repor' : 'contando');
    setFlash(p.id);
  }, [focusId, data, all, setParams]);
  useEffect(() => {
    if (!flash) return;
    document.getElementById(`stock-${flash}`)?.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(t);
  }, [flash]);

  const subtitle = data
    ? counts.contando
      ? `${counts.contando} ${counts.contando === 1 ? 'produto contando' : 'produtos contando'}${
          counts.repor ? ` · ${counts.repor} para repor` : ''
        }`
      : 'Nenhum produto contando estoque ainda'
    : undefined;

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
          <Segmented
            label="mostrar"
            value={shown}
            onChange={(v) => {
              flush();
              setFilter(v);
            }}
            className="mb-4"
            options={[
              { value: 'repor', label: 'Para repor', count: counts.repor },
              { value: 'contando', label: 'Contando', count: counts.contando },
              { value: 'sem', label: 'Sem contar', count: counts.sem },
            ]}
          />
          {all.length > 8 ? (
            <div className="mb-4">
              <TextInput
                type="search"
                aria-label="buscar produto"
                placeholder="Buscar produto"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                lead={<MagnifyingGlass className="size-5" />}
              />
            </div>
          ) : null}
          <Hint id="stock-screen" className="mb-5">
            Cada venda desconta sozinha. Quando chega a zero, o produto aparece como esgotado na
            loja. Toque no número para digitar uma contagem ou o que chegou.
          </Hint>

          {!groups.length ? (
            needle ? (
              <EmptyState
                art={<Mascote pose="sem-resultados" />}
                title={`Nenhum produto com “${q.trim()}”`}
                body="Confira se está escrito certo, ou procure em outra aba."
              />
            ) : shown === 'repor' ? (
              <DuaNote pose="sucesso" title="Nada para repor agora">
                Quando um produto acabar ou chegar no aviso de estoque baixo, ele aparece aqui.
              </DuaNote>
            ) : shown === 'contando' ? (
              <DuaNote
                pose="catalogo"
                title="Nenhum produto contando estoque"
                action={
                  <Button size="sm" variant="secondary" onClick={() => setFilter('sem')}>
                    ver produtos sem contar
                  </Button>
                }
              >
                Faz sob encomenda? Não precisa contar. Se tem uma quantidade certa, comece por lá.
              </DuaNote>
            ) : (
              <DuaNote pose="sucesso" title="Todos os produtos já contam estoque" />
            )
          ) : (
            <div className="space-y-6">
              {groups.map(({ c, rows }) => (
                <section key={c.id} aria-labelledby={`stock-cat-${c.id}`}>
                  <h2 id={`stock-cat-${c.id}`} className="t-label mb-2 px-1 text-muted">
                    {c.name}
                  </h2>
                  <Card className="divide-y divide-line overflow-hidden">
                    {rows.map((p) => (
                      <StockRow
                        key={p.id}
                        p={p}
                        count={countOf(p)}
                        dirty={!!pending[p.id]}
                        flash={flash === p.id}
                        onTap={(by) => tap(p, by)}
                        onEdit={() => {
                          flush();
                          setEditing(p);
                        }}
                      />
                    ))}
                  </Card>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <CountSheet
        p={editing}
        onClose={() => setEditing(null)}
        onAdd={(p, add) => run([{ productId: p.id, add }])}
        settled={() => Promise.all([...inflight.current])}
      />
    </PageBody>
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

  const status = !tracked ? (
    <span className="text-muted">não conta estoque</span>
  ) : out ? (
    <span className="font-semibold text-danger">
      acabou{p.waiting ? ` · ${p.waiting} na espera` : ''}
    </span>
  ) : low ? (
    <span className="font-semibold text-warning">pouco · aviso com {p.lowStockThreshold}</span>
  ) : (
    <span className="text-muted">
      {p.lowStockThreshold != null ? `aviso com ${p.lowStockThreshold}` : 'sem aviso'}
    </span>
  );
  const extra =
    p.status === 'archived' ? 'escondido' : p.status === 'sold_out' ? 'marcado esgotado' : null;

  return (
    <div
      id={`stock-${p.id}`}
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
            {status}
            {extra ? <span className="text-muted"> · {extra}</span> : null}
          </span>
        </span>
      </Link>

      {tracked ? (
        <div
          role="group"
          aria-label={`estoque de ${p.name}`}
          className="flex shrink-0 items-center rounded-full bg-sunken p-0.5"
        >
          <button
            type="button"
            aria-label={`tirar 1 de ${p.name}`}
            disabled={count <= 0}
            onClick={() => onTap(-1)}
            className="press grid size-11 place-items-center rounded-full hover:bg-press active:bg-press disabled:opacity-35"
          >
            <Minus weight="bold" className="size-4.5" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${count} em estoque de ${p.name}. Digitar quantidade`}
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
            aria-label={`pôr mais 1 de ${p.name}`}
            disabled={count >= MAX}
            onClick={() => onTap(1)}
            className="press grid size-11 place-items-center rounded-full hover:bg-press active:bg-press disabled:opacity-35"
          >
            <Plus weight="bold" className="size-4.5" />
          </button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="h-11 shrink-0"
          onClick={onEdit}
          aria-label={`contar estoque de ${p.name}`}
        >
          contar
        </Button>
      )}
    </div>
  );
}

type Mode = 'chegou' | 'contei';

function CountSheet({
  p: open,
  onClose,
  onAdd,
  settled,
}: {
  p: Product | null;
  onClose: () => void;
  onAdd: (p: Product, add: number) => void;
  settled: () => Promise<unknown>;
}) {
  const qc = useQueryClient();
  // the last product stays while the sheet slides away
  const [p, setP] = useState(open);
  if (open && open !== p) setP(open);
  const tracked = p?.stockQuantity != null;
  const [mode, setMode] = useState<Mode>('chegou');
  const [value, setValue] = useState('');
  const [threshold, setThreshold] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMode(open.stockQuantity == null ? 'contei' : 'chegou');
    setValue('');
    setThreshold(open.lowStockThreshold ?? 0);
    setErr(null);
  }, [open]);

  const save = useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown> }) =>
      api.updateProduct(v.id, v.patch),
    onSuccess: (r) => {
      qc.setQueryData<Catalog>(qk.catalog, (d) =>
        d ? mapProducts(d, (x) => (x.id === r.product.id ? { ...x, ...r.product } : x)) : d,
      );
      qc.setQueryData(qk.product(r.product.id), { product: r.product });
      void qc.invalidateQueries({ queryKey: qk.catalog });
    },
  });

  if (!p) return null;

  const n = value.trim() === '' ? null : Number(value);
  const valid = n !== null && Number.isInteger(n) && n >= 0 && n <= MAX;
  const now = p.stockQuantity ?? 0;
  const result = !valid ? null : mode === 'chegou' ? Math.min(MAX, now + n!) : n!;
  const thresholdChanged = tracked && threshold !== (p.lowStockThreshold ?? 0);

  const submit = async () => {
    if (!valid && !thresholdChanged) {
      setErr('Digite um número, como 12.');
      input.current?.focus();
      return;
    }
    if (n !== null && !valid) {
      setErr('Use só números inteiros, de 0 em diante.');
      return;
    }
    try {
      const patch: Record<string, unknown> = {};
      if (valid && mode === 'contei') patch.stockQuantity = n;
      if (thresholdChanged) patch.lowStockThreshold = threshold || null;
      let woken = 0;
      if ('stockQuantity' in patch) await settled();
      if (Object.keys(patch).length)
        woken = (await save.mutateAsync({ id: p.id, patch })).waitlistWoken;
      // a delivery is relative: the sales of the last minutes still count
      if (valid && mode === 'chegou' && n) onAdd(p, n);
      haptic.commit();
      toast(
        result !== null
          ? `${p.name}: ${result} em estoque${woken ? ` · avisamos ${woken} da lista de espera` : ''}`
          : `${p.name}: aviso com ${threshold || 'nenhum'}`,
      );
      onClose();
    } catch (e) {
      setErr(messageOf(e));
    }
  };

  const stopCounting = async () => {
    try {
      await save.mutateAsync({
        id: p.id,
        patch: { stockQuantity: null, lowStockThreshold: null },
      });
      toast(`${p.name} não conta mais estoque`);
      onClose();
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  return (
    <Sheet
      open={!!open}
      onOpenChange={(v) => !v && onClose()}
      title={p.name}
      description={
        tracked
          ? `${now} em estoque agora`
          : 'Diga quantos tem. Cada venda desconta sozinha e, no zero, ele aparece como esgotado.'
      }
      footer={
        <Button block size="lg" loading={save.isPending} onClick={() => void submit()}>
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
            onChange={(v) => {
              setMode(v);
              setErr(null);
              input.current?.focus();
            }}
            options={[
              { value: 'chegou', label: 'Chegou mais' },
              { value: 'contei', label: 'Contei tudo' },
            ]}
          />
        ) : null}
        <Field
          label={mode === 'chegou' ? 'Quantos chegaram?' : 'Quantos tem agora?'}
          htmlFor="stock-count"
          error={err}
          helper={
            result !== null && tracked
              ? mode === 'chegou'
                ? `Fica com ${result} em estoque.`
                : `Era ${now}, fica ${result}.`
              : mode === 'chegou'
                ? 'Somamos ao que já tem.'
                : 'O número que vale a partir de agora.'
          }
        >
          <TextInput
            ref={input}
            id="stock-count"
            inputMode="numeric"
            enterKeyHint="done"
            autoFocus
            placeholder={mode === 'chegou' ? 'ex.: 12' : String(now)}
            value={value}
            aria-invalid={!!err}
            onChange={(e) => {
              setValue(e.target.value.replace(/\D/g, '').slice(0, 7));
              setErr(null);
            }}
            lead={mode === 'chegou' && tracked ? '+' : undefined}
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
        {tracked ? (
          <Button
            type="button"
            variant="ghost"
            className="-ml-3 text-muted"
            onClick={() => void stopCounting()}
          >
            parar de contar o estoque deste produto
          </Button>
        ) : null}
      </form>
    </Sheet>
  );
}
