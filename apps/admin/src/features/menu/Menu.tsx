import {
  ArrowDown,
  ArrowUp,
  ClipboardText,
  FolderSimplePlus,
  GridFour,
  ListBullets,
  PencilSimple,
  Plus,
  Selection,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Category, type Product } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk } from '../../lib/query.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState, Hint, Loading, messageOf } from '../../ui/feedback.tsx';
import {
  Chips,
  Field,
  MoneyField,
  Select,
  Segmented,
  TextArea,
  TextInput,
} from '../../ui/fields.tsx';
import { ArtBox } from '../../ui/illustrations.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { availability, ProductTile } from '../../ui/ProductTile.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';

type View = 'grade' | 'lista';
type Avail = 'available' | 'sold_out_today' | 'sold_out' | 'hidden';

const AVAIL_LABEL: Record<Avail, string> = {
  available: 'disponível',
  sold_out_today: 'esgotado hoje',
  sold_out: 'esgotado',
  hidden: 'escondido',
};

function readView(): View {
  try {
    return localStorage.getItem('vendua-menu-view') === 'lista' ? 'lista' : 'grade';
  } catch {
    return 'grade';
  }
}

export default function Menu() {
  const { data, error, refetch, isPending } = useQuery({
    queryKey: qk.catalog,
    queryFn: api.catalog,
  });
  const qc = useQueryClient();
  const nav = useNavigate();
  const [view, setView] = useState<View>(readView);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<
    null | 'new' | 'category' | 'import' | 'organize' | 'bulk-price' | 'bulk-category'
  >(null);
  // the "Novo produto" app shortcut and photos shared from the gallery land here
  const [search, setSearch] = useSearchParams();
  const shared = search.get('foto') === 'compartilhada';
  const [fromShare, setFromShare] = useState(false);
  useEffect(() => {
    if (search.get('novo') !== '1' && !shared) return;
    setFromShare(shared);
    setSheet('new');
    setSearch({}, { replace: true });
  }, [search, shared, setSearch]);
  const [availFor, setAvailFor] = useState<Product | null>(null);
  const cats = data?.categories ?? [];
  useEffect(() => {
    try {
      localStorage.setItem('vendua-menu-view', view);
    } catch {
      /* ignore */
    }
  }, [view]);

  const setAvail = useMutation({
    mutationFn: (v: { p: Product; to: Avail; silent?: boolean }) =>
      api.updateProduct(v.p.id, { availability: v.to }),
    onSuccess: (r, v) => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
      if (v.silent) return;
      const prev = availability(v.p);
      toast(
        `${v.p.name}: ${AVAIL_LABEL[v.to]}${r.waitlistWoken ? ` · ${r.waitlistWoken} na lista de espera` : ''}`,
        {
          undo: () =>
            setAvail.mutate({
              p: { ...v.p },
              to: prev === 'available' ? 'available' : prev === 'hidden' ? 'hidden' : 'sold_out',
              silent: true,
            }),
        },
      );
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const bulk = useMutation({
    mutationFn: (v: { action: string; extra?: Record<string, unknown> }) =>
      api.bulk([...picked], v.action, v.extra),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
      toast(`${r.updated} produtos atualizados`);
      setPicked(new Set());
      setSelecting(false);
      setSheet(null);
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      haptic.tick();
      return n;
    });

  const total = cats.reduce((a, c) => a + c.products.length, 0);

  return (
    <PageBody wide>
      <PageHeader
        title="Cardápio"
        subtitle={data ? `${total} produtos em ${cats.length} categorias` : undefined}
        actions={
          <>
            <Button variant="secondary" icon={<ClipboardText />} onClick={() => setSheet('import')}>
              colar lista
            </Button>
            <Button icon={<Plus weight="bold" />} onClick={() => setSheet('new')}>
              novo produto
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="visualização"
          value={view}
          onChange={setView}
          className="w-full sm:w-72"
          options={[
            {
              value: 'grade',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <GridFour className="size-5" /> fotos
                </span>
              ),
            },
            {
              value: 'lista',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <ListBullets className="size-5" /> lista
                </span>
              ),
            },
          ]}
        />
        <div className="flex-1" />
        <Button
          variant={selecting ? 'primary' : 'ghost'}
          icon={selecting ? <X /> : <Selection />}
          onClick={() => {
            setSelecting((v) => !v);
            setPicked(new Set());
          }}
        >
          {selecting ? 'cancelar seleção' : 'selecionar'}
        </Button>
        <Button variant="ghost" icon={<FolderSimplePlus />} onClick={() => setSheet('organize')}>
          categorias
        </Button>
      </div>

      {cats.length > 1 ? (
        <nav aria-label="categorias" className="-mx-4 mb-5 overflow-x-auto px-4 md:-mx-8 md:px-8">
          <ul className="flex w-max gap-2">
            {cats.map((c) => (
              <li key={c.id}>
                <a
                  href={`#cat-${c.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document
                      .getElementById(`cat-${c.id}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="t-label inline-flex min-h-11 items-center gap-2 rounded-full bg-surface px-4 ring-1 ring-line-strong hover:bg-hover"
                >
                  {c.name}
                  <span className="tnum text-muted">
                    {c.products.filter((p) => p.status !== 'archived').length}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <Hint id="menu-longpress" className="mb-5">
        Segure uma foto para arrastar e mudar a ordem. No modo lista, toque na disponibilidade para
        marcar “esgotado hoje”.
      </Hint>

      {error && !data ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : isPending ? (
        <Loading />
      ) : !cats.length ? (
        <EmptyState
          art={<ArtBox />}
          title="Seu cardápio está vazio"
          body="Comece criando uma categoria, como “Doces” ou “Lanches”. Se já tem o cardápio no WhatsApp, é só colar."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button icon={<FolderSimplePlus />} onClick={() => setSheet('category')}>
                criar categoria
              </Button>
              <Button
                variant="secondary"
                icon={<ClipboardText />}
                onClick={() => setSheet('import')}
              >
                colar do WhatsApp
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-8">
          {cats.map((c) => (
            <section
              key={c.id}
              id={`cat-${c.id}`}
              className="scroll-mt-24"
              aria-labelledby={`cat-${c.id}-t`}
            >
              <h2 id={`cat-${c.id}-t`} className="t-title-2 mb-3 px-1">
                {c.name}
              </h2>
              {!c.products.length ? (
                <Card className="p-5 text-center">
                  <p className="t-body text-muted">Nenhum produto em {c.name} ainda.</p>
                  <Button
                    variant="secondary"
                    className="mt-3"
                    icon={<Plus />}
                    onClick={() => setSheet('new')}
                  >
                    adicionar produto
                  </Button>
                </Card>
              ) : view === 'grade' ? (
                <ReorderGrid
                  cat={c}
                  selecting={selecting}
                  picked={picked}
                  onToggle={toggle}
                  onOpen={(p) => nav(`/cardapio/produto/${p.id}`)}
                />
              ) : (
                <Card className="divide-y divide-line overflow-hidden">
                  {c.products.map((p) => (
                    <ListRow
                      key={p.id}
                      p={p}
                      selecting={selecting}
                      picked={picked.has(p.id)}
                      onToggle={() => toggle(p.id)}
                      onAvail={() => setAvailFor(p)}
                      onSoldOutToday={() => setAvail.mutate({ p, to: 'sold_out_today' })}
                    />
                  ))}
                </Card>
              )}
            </section>
          ))}
        </div>
      )}

      {/* phone: the primary action in the thumb zone */}
      {!selecting ? (
        <button
          type="button"
          onClick={() => setSheet('new')}
          className="t-label fixed bottom-[calc(88px+env(safe-area-inset-bottom))] right-4 z-30 inline-flex h-14 items-center gap-2 rounded-full bg-primary px-5 text-on-primary depth-3 md:hidden"
        >
          <Plus weight="bold" className="size-5" /> produto
        </button>
      ) : (
        <div className="glass fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 border-t border-line px-4 py-3 md:bottom-4 md:left-auto md:right-6 md:rounded-lg md:border-0 md:depth-3">
          <p className="t-caption mb-2 text-muted">{picked.size} selecionados</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!picked.size}
              onClick={() => bulk.mutate({ action: 'available' })}
            >
              disponível
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!picked.size}
              onClick={() => bulk.mutate({ action: 'sold_out_today' })}
            >
              esgotado hoje
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!picked.size}
              onClick={() => bulk.mutate({ action: 'hidden' })}
            >
              esconder
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!picked.size}
              onClick={() => setSheet('bulk-category')}
            >
              mover
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!picked.size}
              onClick={() => setSheet('bulk-price')}
            >
              preço %
            </Button>
          </div>
        </div>
      )}

      <NewProductSheet
        open={sheet === 'new'}
        onOpenChange={(v) => setSheet(v ? 'new' : null)}
        cats={cats}
        sharedPhoto={fromShare}
        onNeedCategory={() => setSheet('category')}
      />
      <NewCategorySheet
        open={sheet === 'category'}
        onOpenChange={(v) => setSheet(v ? 'category' : null)}
      />
      <ImportSheet
        open={sheet === 'import'}
        onOpenChange={(v) => setSheet(v ? 'import' : null)}
        cats={cats}
        onNeedCategory={() => setSheet('category')}
      />
      <OrganizeSheet
        open={sheet === 'organize'}
        onOpenChange={(v) => setSheet(v ? 'organize' : null)}
        cats={cats}
        onNew={() => setSheet('category')}
      />
      <BulkPriceSheet
        open={sheet === 'bulk-price'}
        onOpenChange={(v) => setSheet(v ? 'bulk-price' : null)}
        count={picked.size}
        loading={bulk.isPending}
        onApply={(percent) => bulk.mutate({ action: 'price_percent', extra: { percent } })}
      />
      <Sheet
        open={sheet === 'bulk-category'}
        onOpenChange={(v) => setSheet(v ? 'bulk-category' : null)}
        title={`Mover ${picked.size} produtos para…`}
      >
        <div className="grid gap-2 pt-1">
          {cats.map((c) => (
            <Button
              key={c.id}
              variant="secondary"
              size="lg"
              block
              onClick={() => bulk.mutate({ action: 'category', extra: { categoryId: c.id } })}
            >
              {c.name}
            </Button>
          ))}
        </div>
      </Sheet>
      <Sheet
        open={!!availFor}
        onOpenChange={(v) => !v && setAvailFor(null)}
        title={availFor?.name ?? ''}
        description="Como fica na loja agora?"
      >
        <div className="grid gap-2 pt-1">
          {(['available', 'sold_out_today', 'sold_out', 'hidden'] as Avail[]).map((a) => (
            <Button
              key={a}
              variant={a === 'sold_out_today' ? 'primary' : 'secondary'}
              size="lg"
              block
              onClick={() => {
                if (availFor) setAvail.mutate({ p: availFor, to: a });
                setAvailFor(null);
              }}
            >
              {AVAIL_LABEL[a]}
              {a === 'sold_out_today' ? (
                <span className="t-caption opacity-80">· volta amanhã sozinho</span>
              ) : null}
            </Button>
          ))}
        </div>
      </Sheet>
    </PageBody>
  );
}

/** Long-press lifts a tile; the others make room; drop saves the order (§6.6). */
function ReorderGrid({
  cat,
  selecting,
  picked,
  onToggle,
  onOpen,
}: {
  cat: Category;
  selecting: boolean;
  picked: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (p: Product) => void;
}) {
  const qc = useQueryClient();
  const [order, setOrder] = useState<string[]>(() => cat.products.map((p) => p.id));
  const [lifted, setLifted] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const origin = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  useEffect(() => setOrder(cat.products.map((p) => p.id)), [cat.products]);
  const byId = useMemo(() => new Map(cat.products.map((p) => [p.id, p])), [cat.products]);
  const save = useMutation({
    mutationFn: (ids: string[]) => api.orderProducts(cat.id, ids),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.catalog }),
    onError: (e) => toast.error(messageOf(e)),
  });

  const down = (id: string, e: React.PointerEvent) => {
    if (selecting || (e.pointerType === 'mouse' && e.button !== 0)) return;
    origin.current = { x: e.clientX, y: e.clientY };
    dragged.current = false;
    const target = e.currentTarget as HTMLElement;
    const pid = e.pointerId;
    timer.current = setTimeout(() => {
      setLifted(id);
      haptic.tick();
      target.setPointerCapture(pid);
    }, 350);
  };
  const move = (e: React.PointerEvent) => {
    if (!lifted) {
      if (
        origin.current &&
        Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 8
      )
        clearTimeout(timer.current);
      return;
    }
    dragged.current = true;
    const el = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('[data-reorder-id]');
    const over = el?.dataset.reorderId;
    if (!over || over === lifted) return;
    setOrder((o) => {
      const from = o.indexOf(lifted);
      const to = o.indexOf(over);
      if (from < 0 || to < 0) return o;
      const n = [...o];
      n.splice(from, 1);
      n.splice(to, 0, lifted);
      haptic.tick();
      return n;
    });
  };
  const up = () => {
    clearTimeout(timer.current);
    if (lifted) {
      setLifted(null);
      const before = cat.products.map((p) => p.id).join();
      if (order.join() !== before) save.mutate(order);
    }
  };

  return (
    <ul
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6"
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {order.map((id) => {
        const p = byId.get(id);
        if (!p) return null;
        return (
          <li
            key={id}
            data-reorder-id={id}
            onPointerDown={(e) => down(id, e)}
            onContextMenu={(e) => e.preventDefault()}
            className={cn(
              'select-none',
              lifted && lifted !== id && 'transition-transform duration-(--duration-smooth)',
            )}
            style={{ touchAction: lifted ? 'none' : 'manipulation' }}
          >
            <button
              type="button"
              className="block w-full text-left"
              aria-label={selecting ? `selecionar ${p.name}` : `editar ${p.name}`}
              aria-pressed={selecting ? picked.has(id) : undefined}
              onClick={(e) => {
                if (dragged.current) {
                  e.preventDefault();
                  return;
                }
                if (selecting) onToggle(id);
                else onOpen(p);
              }}
            >
              <ProductTile
                p={p}
                selecting={selecting}
                selected={picked.has(id)}
                lifted={lifted === id}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ListRow({
  p,
  selecting,
  picked,
  onToggle,
  onAvail,
  onSoldOutToday,
}: {
  p: Product;
  selecting: boolean;
  picked: boolean;
  onToggle: () => void;
  onAvail: () => void;
  onSoldOutToday: () => void;
}) {
  const a = availability(p);
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; lock: 'x' | 'y' | null } | null>(null);
  return (
    <div className="relative isolate">
      {dx < 0 ? (
        <div
          aria-hidden
          className="absolute inset-0 -z-10 flex items-center justify-end bg-danger-soft px-5 t-label text-danger"
        >
          esgotado hoje
        </div>
      ) : null}
      <div
        className="flex min-h-18 items-center gap-3 bg-surface px-3 py-2"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }}
        onPointerDown={(e) => (start.current = { x: e.clientX, y: e.clientY, lock: null })}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const mx = e.clientX - s.x;
          if (!s.lock) {
            if (Math.abs(mx) < 8 && Math.abs(e.clientY - s.y) < 8) return;
            s.lock = Math.abs(mx) > Math.abs(e.clientY - s.y) ? 'x' : 'y';
          }
          if (s.lock === 'x') setDx(Math.min(0, mx));
        }}
        onPointerUp={(e) => {
          const w = (e.currentTarget as HTMLElement).offsetWidth;
          if (dx < -w * 0.35 && a !== 'sold_out') {
            haptic.commit();
            onSoldOutToday();
          }
          setDx(0);
          start.current = null;
        }}
        onPointerCancel={() => {
          setDx(0);
          start.current = null;
        }}
      >
        {selecting ? (
          <input
            type="checkbox"
            checked={picked}
            onChange={onToggle}
            aria-label={`selecionar ${p.name}`}
            className="size-6 accent-(--primary)"
          />
        ) : null}
        <span
          className={cn(
            'size-14 shrink-0 overflow-hidden rounded-sm bg-sunken',
            a === 'sold_out' && 'grayscale',
          )}
          style={p.dominant ? { background: p.dominant } : undefined}
        >
          {p.imageUrl ? (
            <img src={p.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
          ) : null}
        </span>
        <Link to={`/cardapio/produto/${p.id}`} className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{p.name}</span>
          <span className="tnum t-body text-muted">
            {money(p.priceCents)}
            {p.stockQuantity != null ? ` · ${p.stockQuantity} un.` : ''}
          </span>
        </Link>
        <button
          type="button"
          onClick={onAvail}
          className={cn(
            't-caption min-h-11 shrink-0 rounded-full px-3 font-semibold ring-1',
            a === 'available' && 'bg-success-soft text-success ring-success/30',
            a === 'sold_out' && 'bg-danger-soft text-danger ring-danger/30',
            a === 'hidden' && 'bg-sunken text-muted ring-line',
          )}
        >
          {a === 'available'
            ? 'disponível'
            : a === 'sold_out'
              ? p.soldOutUntil
                ? 'esgotado hoje'
                : 'esgotado'
              : 'escondido'}
        </button>
      </div>
    </div>
  );
}

function NewProductSheet({
  open,
  onOpenChange,
  cats,
  onNeedCategory,
  sharedPhoto,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cats: Category[];
  onNeedCategory: () => void;
  sharedPhoto?: boolean;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [cat, setCat] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName('');
      setPrice(null);
      setErr(null);
      setCat((c) => c || cats[0]?.id || '');
    }
  }, [open, cats]);
  const create = useMutation({
    mutationFn: () =>
      api.createProduct({ name: name.trim(), priceCents: price ?? 0, categoryId: cat }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
      onOpenChange(false);
      toast(
        sharedPhoto
          ? `${r.product.name} criado. Ajuste a foto que você mandou.`
          : `${r.product.name} criado. Agora é só pôr uma foto.`,
      );
      nav(`/cardapio/produto/${r.product.id}?foto=${sharedPhoto ? 'compartilhada' : '1'}`);
    },
    onError: (e) => setErr(messageOf(e)),
  });
  useEffect(() => {
    // no category yet: the first product needs one
    if (open && !cats.length) {
      onOpenChange(false);
      onNeedCategory();
    }
  }, [open, cats.length, onOpenChange, onNeedCategory]);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Novo produto"
      description={
        sharedPhoto
          ? 'A foto chegou. Dê um nome e um preço; você ajusta a foto no próximo passo.'
          : 'Só o básico agora. Foto, opções e estoque vêm no próximo passo.'
      }
      footer={
        <Button
          size="lg"
          block
          loading={create.isPending}
          onClick={() => {
            if (name.trim().length < 2) return setErr('Dê um nome com pelo menos 2 letras.');
            if (price === null) return setErr('Informe o preço.');
            create.mutate();
          }}
        >
          {sharedPhoto ? 'criar com esta foto' : 'criar e adicionar foto'}
        </Button>
      }
    >
      <div className="space-y-5 pt-2">
        <Field label="Nome" htmlFor="np-name">
          <TextInput
            id="np-name"
            autoFocus
            maxLength={120}
            placeholder="Ex.: Pudim de leite"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Preço" htmlFor="np-price">
          <MoneyField id="np-price" cents={price} onCommit={setPrice} />
        </Field>
        <Field label="Categoria" htmlFor="np-cat">
          <Select
            id="np-cat"
            value={cat}
            onChange={setCat}
            options={cats.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        {err ? (
          <p className="t-body text-danger" role="alert">
            {err}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function NewCategorySheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.createCategory(name.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
      toast(`Categoria “${name.trim()}” criada`);
      setName('');
      onOpenChange(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Nova categoria"
      footer={
        <Button
          size="lg"
          block
          loading={create.isPending}
          disabled={!name.trim()}
          onClick={() => create.mutate()}
        >
          criar categoria
        </Button>
      }
    >
      <Field
        label="Nome"
        htmlFor="nc-name"
        helper="Como aparece no cardápio: “Pudins”, “Bebidas”, “Kits”."
        className="pt-2"
      >
        <TextInput
          id="nc-name"
          autoFocus
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && create.mutate()}
        />
      </Field>
    </Sheet>
  );
}

function ImportSheet({
  open,
  onOpenChange,
  cats,
  onNeedCategory,
  sharedPhoto,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cats: Category[];
  onNeedCategory: () => void;
  sharedPhoto?: boolean;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [cat, setCat] = useState('');
  const [items, setItems] = useState<{ name: string; priceCents: number }[]>([]);
  useEffect(() => setCat((c) => c || cats[0]?.id || ''), [cats]);
  useEffect(() => {
    if (!text.trim()) return setItems([]);
    const t = setTimeout(() => {
      api.importPreview(text).then(
        (r) => setItems(r.items),
        () => setItems([]),
      );
    }, 300);
    return () => clearTimeout(t);
  }, [text]);
  const run = useMutation({
    mutationFn: () => api.importProducts(text, cat),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
      toast(`${r.created} produtos criados. Adicione as fotos quando puder.`);
      setText('');
      onOpenChange(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Colar cardápio do WhatsApp"
      description="Uma linha por produto, com o preço no fim. Ex.: “Pudim de leite - R$ 12,50”."
      wide
      footer={
        cats.length ? (
          <Button
            size="lg"
            block
            disabled={!items.length}
            loading={run.isPending}
            onClick={() => run.mutate()}
          >
            {items.length ? `criar ${items.length} produtos` : 'cole a lista acima'}
          </Button>
        ) : (
          <Button size="lg" block onClick={onNeedCategory}>
            criar uma categoria primeiro
          </Button>
        )
      }
    >
      <div className="space-y-4 pt-2">
        <Field label="Lista" htmlFor="imp-text">
          <TextArea
            id="imp-text"
            autoFocus
            rows={7}
            maxLength={20000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Pudim de leite - 12,50\nPudim de coco - 14\nBrigadeiro 4,00'}
          />
        </Field>
        {cats.length ? (
          <Field label="Na categoria" htmlFor="imp-cat">
            <Select
              id="imp-cat"
              value={cat}
              onChange={setCat}
              options={cats.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
        ) : null}
        {items.length ? (
          <div>
            <p className="t-label mb-2">Vamos criar:</p>
            <ul className="divide-y divide-line rounded-md ring-1 ring-line">
              {items.map((it, i) => (
                <li key={i} className="flex justify-between gap-3 px-3 py-2">
                  <span className="truncate">{it.name}</span>
                  <span className="tnum shrink-0 font-semibold">{money(it.priceCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : text.trim() ? (
          <p className="t-body text-muted">Ainda não achamos linhas com nome e preço.</p>
        ) : null}
      </div>
    </Sheet>
  );
}

function OrganizeSheet({
  open,
  onOpenChange,
  cats,
  onNew,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cats: Category[];
  onNew: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.catalog });
  const reorder = useMutation({
    mutationFn: api.orderCategories,
    onSuccess: refresh,
    onError: (e) => toast.error(messageOf(e)),
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => api.renameCategory(v.id, v.name),
    onSuccess: () => {
      refresh();
      setEditing(null);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const del = useMutation({
    mutationFn: api.deleteCategory,
    onSuccess: () => {
      refresh();
      toast('Categoria apagada');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = cats.map((c) => c.id);
    const [x] = ids.splice(i, 1);
    ids.splice(i + d, 0, x!);
    haptic.tick();
    reorder.mutate(ids);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Categorias"
      description="A ordem aqui é a ordem do cardápio na loja."
      footer={
        <Button variant="secondary" size="lg" block icon={<Plus />} onClick={onNew}>
          nova categoria
        </Button>
      }
    >
      <ul className="space-y-2 pt-2">
        {cats.map((c, i) => (
          <li key={c.id} className="flex items-center gap-1 rounded-md bg-sunken p-1.5 pl-3">
            {editing === c.id ? (
              <TextInput
                autoFocus
                aria-label="nome da categoria"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                onBlur={() =>
                  name.trim() && name.trim() !== c.name
                    ? rename.mutate({ id: c.id, name: name.trim() })
                    : setEditing(null)
                }
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="h-11"
              />
            ) : (
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="t-caption text-muted">{c.products.length} produtos</span>
              </span>
            )}
            <IconButton label="subir" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </IconButton>
            <IconButton
              label="descer"
              size="sm"
              disabled={i === cats.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown />
            </IconButton>
            <IconButton
              label={`renomear ${c.name}`}
              size="sm"
              onClick={() => {
                setEditing(c.id);
                setName(c.name);
              }}
            >
              <PencilSimple />
            </IconButton>
            <IconButton label={`apagar ${c.name}`} size="sm" onClick={() => del.mutate(c.id)}>
              <Trash />
            </IconButton>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function BulkPriceSheet({
  open,
  onOpenChange,
  count,
  onApply,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  count: number;
  onApply: (pct: number) => void;
  loading: boolean;
}) {
  const [dir, setDir] = useState<'up' | 'down'>('up');
  const [pct, setPct] = useState('10');
  const n = Math.round(Number(pct.replace(',', '.')));
  const ok = Number.isFinite(n) && n > 0 && n <= (dir === 'up' ? 300 : 90);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Ajustar o preço de ${count} produtos`}
      description="Os preços são arredondados para os 10 centavos mais próximos."
      footer={
        <Button
          size="lg"
          block
          disabled={!ok}
          loading={loading}
          onClick={() => onApply(dir === 'up' ? n : -n)}
        >
          {dir === 'up' ? 'aumentar' : 'baixar'} {ok ? `${n}%` : ''}
        </Button>
      }
    >
      <div className="space-y-4 pt-2">
        <Chips
          label="direção"
          value={dir}
          onChange={setDir}
          options={[
            { value: 'up', label: 'aumentar' },
            { value: 'down', label: 'baixar' },
          ]}
        />
        <Field label="Quanto?" htmlFor="bp">
          <TextInput
            id="bp"
            inputMode="numeric"
            trail="%"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
          />
        </Field>
        <p className="t-body text-muted">
          Ex.: um produto de {money(1250)} fica{' '}
          {money(Math.round((1250 * (100 + (dir === 'up' ? n || 0 : -(n || 0)))) / 1000) * 10)}.
        </p>
      </div>
    </Sheet>
  );
}
