import {
  ArrowCounterClockwise,
  ArrowRight,
  Bell,
  CashRegister,
  ClockCounterClockwise,
  Clock,
  Compass,
  Fire,
  LinkSimple,
  MagnifyingGlass,
  Package,
  Pause,
  Play,
  PlusCircle,
  Printer,
  ProhibitInset,
  Receipt,
  Ticket,
  Timer,
  User,
  UsersThree,
  Wallet,
  WhatsappLogo,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { whatsappUrl } from '@vendua/kernel/rules';
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type SearchResult } from '../lib/api.ts';
import { ago, money, phone } from '../lib/format.ts';
import { haptic } from '../lib/haptics.ts';
import { qk, useMutation } from '../lib/query.ts';
import { pushRecent, readRecent, type Recent } from '../lib/recent.ts';
import { can, featureOpen, useSession } from '../lib/session.ts';
import { mediaUrl } from '../lib/media.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { StateChip } from '../ui/StateChip.tsx';
import { TextInput } from '../ui/fields.tsx';
import { EmptyState, messageOf } from '../ui/feedback.tsx';
import { RowsSkeleton } from '../ui/skeletons.tsx';
import { Mascote } from '../ui/Mascote.tsx';
import { cn } from '../ui/cn.ts';
import { copyText } from '../ui/CopyValue.tsx';
import { toast } from '../ui/Toast.tsx';
import { useStoreQuery } from '../features/store/StatusPill.tsx';
import {
  findActions,
  parseQuery,
  suggestedActions,
  type ActionContext,
  type ActionEntry,
  type ActionId,
} from './actions.ts';
import { findScreens } from './screens.ts';

const StatusSheet = lazy(() =>
  import('../features/store/StatusSheet.tsx').then((m) => ({ default: m.StatusSheet })),
);

const ACTION_ICON: Record<ActionId, Icon> = {
  pause: Pause,
  resume: Play,
  demand: Fire,
  hours: Clock,
  'sold-out': ProhibitInset,
  'new-product': PlusCircle,
  'new-coupon': Ticket,
  pdv: CashRegister,
  link: LinkSimple,
};

// Início's "Precisa de você", by kind; an order waiting is the one that rings
const NEED_ICON: Record<string, Icon> = {
  orders_waiting: Bell,
  closed_with_orders: Timer,
  pix_to_confirm: Wallet,
  low_stock: Package,
  waitlist: UsersThree,
  waitlist_open: UsersThree,
  print_failed: Printer,
};

const RECENT_ICON: Record<Recent['kind'], Icon> = {
  order: Receipt,
  product: Package,
  customer: User,
  screen: Compass,
};

type Product = SearchResult['products'][number];
type StatusKind = 'pause' | 'demand' | 'hours';

/**
 * One field for finding and for doing (§3.2): orders, products, customers and screens as they
 * type, and the store's everyday moves ("pausar", "novo produto", "acabou pudim") as actions.
 * Empty, it offers what needs them, the likely next move and what they opened lately.
 */
export function SearchSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const s = useSession();
  const role = s.user.role;
  const qc = useQueryClient();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const { term, intent } = parseQuery(q);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 160);
    return () => clearTimeout(t);
  }, [term]);
  const [recent, setRecent] = useState<Recent[]>([]);
  useEffect(() => {
    if (!open) setQ('');
    else setRecent(readRecent(s.store.id));
  }, [open, s.store.id]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const key = ['search', debounced] as const;
  const { data, isFetching } = useQuery({
    queryKey: key,
    queryFn: () => api.search(debounced),
    enabled: debounced.length > 0,
    placeholderData: (p) => p,
  });
  // what needs them now, the same list Início leads with
  const home = useQuery({ queryKey: qk.home, queryFn: api.home, enabled: open && !q.trim() });
  const store = useStoreQuery().data;
  const ctx: ActionContext = {
    allowed: (e) => can(role, e.min) && (!e.feature || featureOpen(s, e.feature)),
    status: store?.status.status ?? null,
    billingHold: !!store?.status.billingHold,
  };

  const [status, setStatus] = useState<{ kind: StatusKind; open: boolean; n: number } | null>(null);
  const resume = useMutation({
    mutationFn: api.resume,
    onSuccess: (st) => {
      qc.setQueryData(qk.store, st);
      void qc.invalidateQueries({ queryKey: qk.home });
      toast(
        st.status.status === 'open'
          ? 'Loja aberta de novo ✓'
          : 'Pausa encerrada. A loja segue o horário normal.',
      );
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  // "esgotar hoje" and "voltar a vender" right on the result; "desfazer" puts back what Core says
  // it changed
  const flip = (id: string, status: string) =>
    qc.setQueryData<SearchResult>(key, (d) =>
      d ? { ...d, products: d.products.map((p) => (p.id === id ? { ...p, status } : p)) } : d,
    );
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ['catalog'] });
    void qc.invalidateQueries({ queryKey: qk.home });
    void qc.invalidateQueries({ queryKey: ['search'] });
  };
  const avail = useMutation({
    mutationFn: (v: { p: Product; to: 'sold_out_today' | 'available' }) => api.bulk([v.p.id], v.to),
    onMutate: (v) => {
      haptic.commit();
      flip(v.p.id, v.to === 'available' ? 'active' : 'sold_out');
    },
    onSuccess: (r, v) => {
      settle();
      if (!r.updated) return toast.error(`${v.p.name} não está mais no cardápio.`);
      const before = r.before ?? [];
      toast(
        v.to === 'available'
          ? `${v.p.name} à venda de novo${r.waitlistWoken ? ` · ${r.waitlistWoken} na lista de espera` : ''}`
          : `${v.p.name} esgotado hoje. Volta amanhã sozinho.`,
        before.length
          ? {
              undo: () =>
                void api
                  .bulkRevert(before)
                  .then(settle)
                  .catch((e) => toast.error(messageOf(e))),
            }
          : {},
      );
    },
    onError: (e, v) => {
      flip(v.p.id, v.p.status);
      haptic.error();
      toast.error(messageOf(e));
    },
  });

  const go = (to: string, r?: Omit<Recent, 'to'>) => {
    if (r) pushRecent(s.store.id, { ...r, to });
    onOpenChange(false);
    nav(to);
  };
  const act = (e: ActionEntry) => {
    const run = e.run;
    if ('fill' in run) {
      setQ(run.fill);
      input.current?.focus();
      return;
    }
    onOpenChange(false);
    if ('go' in run) nav(run.go);
    else if ('sheet' in run)
      setStatus((v) => ({ kind: run.sheet, open: true, n: (v?.n ?? 0) + 1 }));
    else if ('resume' in run) resume.mutate();
    else if ('copyLink' in run)
      void copyText(s.store.url).then((ok) =>
        ok ? toast('Link da loja copiado') : toast.error(`Não deu para copiar: ${s.store.url}`),
      );
  };

  const trimmed = q.trim();
  const actions = findActions(trimmed, ctx);
  // "where do I change the hours?": the screens answer as they type, no request needed
  const screens = intent ? [] : findScreens(trimmed, (e) => can(role, e.min));
  const settled = debounced === term && !isFetching;
  const nothing = !!data && !data.orders.length && !data.products.length && !data.customers.length;
  const sellable = (p: Product) =>
    intent === 'back' ? p.status === 'sold_out' : p.status === 'active' && p.stockQuantity !== 0;

  // Enter: "acabou pudim de coco" with one match does it; anything else opens the first answer,
  // once the answers are for what's typed now
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    if (!enter) return;
    if (term && !settled) return;
    setEnter(false);
    const only = intent && data ? data.products.filter(sellable) : [];
    // done like a command: the sheet goes, so the toast's "desfazer" is in reach (a tap on the
    // row's button keeps the sheet for the next product, the flipped button being its undo)
    if (only.length === 1 && data!.products.length === 1) {
      onOpenChange(false);
      return avail.mutate({ p: only[0]!, to: intent === 'back' ? 'available' : 'sold_out_today' });
    }
    list.current?.querySelector<HTMLElement>('[data-hit]')?.click();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enter, settled, term]);
  const onField = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || !trimmed) return;
    e.preventDefault();
    setEnter(true);
  };
  // ↑ ↓ walk the answers from the field and back to it
  const onArrows = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const hits = [...(list.current?.querySelectorAll<HTMLElement>('[data-hit]') ?? [])];
    if (!hits.length) return;
    e.preventDefault();
    const i = hits.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, hits.length - 1) : i < 0 ? -1 : i - 1;
    if (next < 0) input.current?.focus();
    else hits[next]!.focus();
  };

  const attention = (home.data?.attention ?? []).slice(0, 3);
  const suggested = suggestedActions(ctx);
  const named = intent && !term;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title="Buscar" wide>
        <div onKeyDown={onArrows}>
          <div className="sticky top-0 z-10 bg-surface pb-3 pt-1">
            <TextInput
              ref={input}
              autoFocus
              type="search"
              enterKeyHint="search"
              aria-label="buscar pedidos, produtos, clientes e telas, ou dizer o que fazer"
              placeholder="Buscar ou dizer o que fazer"
              lead={<MagnifyingGlass className="size-5" />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onField}
            />
          </div>
          <div ref={list} className="space-y-5">
            {!trimmed ? (
              <>
                {attention.length ? (
                  <Group title="Precisa de você">
                    {attention.map((a, i) => {
                      const I = NEED_ICON[a.kind] ?? Bell;
                      return (
                        <Hit
                          key={`${a.kind}-${i}`}
                          onClick={() => go(a.href)}
                          icon={<I weight="bold" className="size-5" />}
                          tone={a.kind === 'orders_waiting' ? 'spark' : 'action'}
                        >
                          <Lines title={a.title} sub={a.detail} />
                          <ArrowRight className="size-4 shrink-0 text-muted" />
                        </Hit>
                      );
                    })}
                  </Group>
                ) : null}
                {suggested.length ? (
                  <Group title="Fazer agora">
                    {suggested.map((e) => (
                      <ActionHit key={e.id} e={e} onClick={() => act(e)} />
                    ))}
                  </Group>
                ) : null}
                {recent.length ? (
                  <Group title="Abertos há pouco">
                    {recent.map((r) => {
                      const I = RECENT_ICON[r.kind];
                      return (
                        <Hit key={r.to} onClick={() => go(r.to, r)} icon={<I className="size-5" />}>
                          <Lines title={r.label} sub={r.sub} />
                          <ClockCounterClockwise className="size-4 shrink-0 text-faint" />
                        </Hit>
                      );
                    })}
                  </Group>
                ) : null}
                <div className="flex items-center gap-3 px-1 pb-2 text-muted">
                  <Mascote pose="avatar-pensando" size={48} className="w-12 shrink-0" />
                  <p className="t-caption">
                    Escreva o que procura ou o que quer fazer: “128”, “Ana”, “horário”, “pausar”,
                    “acabou pudim”.
                    <span className="max-md:hidden">
                      {' '}
                      Use {'↑\u00a0↓'} para escolher e Enter para abrir.
                    </span>
                  </p>
                </div>
              </>
            ) : (
              <>
                {actions.length ? (
                  <Group title="Fazer">
                    {actions.map((e) => (
                      <ActionHit key={e.id} e={e} onClick={() => act(e)} />
                    ))}
                  </Group>
                ) : null}
                {screens.length ? (
                  <Group title="Telas">
                    {screens.map((e) => (
                      <Hit
                        key={e.to}
                        onClick={() => go(e.to, { kind: 'screen', label: e.label, sub: e.where })}
                        icon={<Compass className="size-5" />}
                      >
                        <Lines title={e.label} sub={e.where} />
                      </Hit>
                    ))}
                  </Group>
                ) : null}
                {named ? (
                  can(role, 'manager') ? (
                    <p className="t-body px-1 text-muted">
                      Para um produto, escreva o nome: “{trimmed} pudim de coco”.
                    </p>
                  ) : null
                ) : !debounced ? null : nothing && settled ? (
                  actions.length || screens.length ? null : (
                    <EmptyState
                      art={<Mascote pose="sem-resultados" />}
                      title={`Nada encontrado para "${debounced}"`}
                      body="Confira a grafia ou tente só uma parte do nome."
                    />
                  )
                ) : !data ? (
                  <RowsSkeleton rows={4} />
                ) : (
                  <>
                    {intent && data.products.length ? (
                      <Group title="Produtos">
                        {data.products.map((p) => (
                          <ProductHit key={p.id} p={p} intent={intent} go={go} avail={avail} />
                        ))}
                      </Group>
                    ) : null}
                    {data.orders.length ? (
                      <Group title="Pedidos">
                        {data.orders.map((o) => (
                          <Hit
                            key={o.id}
                            onClick={() =>
                              go(`/pedidos/${o.id}`, {
                                kind: 'order',
                                label: `#${o.number} · ${o.name}`,
                                sub: money(o.totalCents),
                              })
                            }
                            icon={<Receipt className="size-5" />}
                          >
                            <Lines
                              title={`#${o.number} · ${o.name}`}
                              sub={`${money(o.totalCents)} · ${ago(o.placedAt)}`}
                            />
                            <StateChip state={o.state} />
                          </Hit>
                        ))}
                      </Group>
                    ) : null}
                    {!intent && data.products.length ? (
                      <Group title="Produtos">
                        {data.products.map((p) => (
                          <ProductHit key={p.id} p={p} intent={null} go={go} avail={avail} />
                        ))}
                      </Group>
                    ) : null}
                    {data.customers.length ? (
                      <Group title="Clientes">
                        {data.customers.map((c) => {
                          const first = c.name.trim().split(/\s+/)[0] ?? c.name;
                          const wa = whatsappUrl(
                            c.phone,
                            `Oi, ${first}! Aqui é da ${s.store.name}.`,
                          );
                          return (
                            <Hit
                              key={c.phone}
                              onClick={() =>
                                go(`/clientes/${c.phone}`, {
                                  kind: 'customer',
                                  label: c.name,
                                  sub: phone(c.phone),
                                })
                              }
                              icon={<User className="size-5" />}
                              trail={
                                wa ? (
                                  <a
                                    href={wa}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={`WhatsApp de ${c.name}`}
                                    className="press grid size-12 shrink-0 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink"
                                  >
                                    <WhatsappLogo className="size-6" />
                                  </a>
                                ) : null
                              }
                            >
                              <Lines
                                title={c.name}
                                sub={`${phone(c.phone)} · ${c.orders} ${c.orders === 1 ? 'pedido' : 'pedidos'}`}
                              />
                            </Hit>
                          );
                        })}
                      </Group>
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </Sheet>
      {status && store ? (
        <Suspense fallback={null}>
          <StatusSheet
            key={status.n}
            open={status.open}
            onOpenChange={(v) => !v && setStatus((x) => (x ? { ...x, open: false } : x))}
            store={store}
            {...(status.kind !== 'pause' ? { startWith: status.kind } : {})}
          />
        </Suspense>
      ) : null}
    </>
  );
}

function ProductHit({
  p,
  intent,
  go,
  avail,
}: {
  p: Product;
  intent: 'sold_out' | 'back' | null;
  go: (to: string, r?: Omit<Recent, 'to'>) => void;
  avail: { mutate: (v: { p: Product; to: 'sold_out_today' | 'available' }) => void };
}) {
  const out = p.status === 'sold_out';
  const hidden = p.status === 'archived';
  // stock at zero is already sold out, and "voltar" wouldn't sell it: that one is Estoque's
  const empty = !out && !hidden && p.stockQuantity === 0;
  // the move the merchant asked for leads; without a verb, the quiet one
  const lead = (intent === 'back' && out) || (intent === 'sold_out' && !out && !hidden);
  return (
    <Hit
      onClick={() =>
        go(`/cardapio/produto/${p.id}`, {
          kind: 'product',
          label: p.name,
          sub: money(p.priceCents),
        })
      }
      icon={
        <span className="block size-10 overflow-hidden rounded-sm bg-sunken">
          {p.imageUrl ? (
            <img src={mediaUrl(p.imageUrl)} alt="" className="size-full object-cover" />
          ) : null}
        </span>
      }
      trail={
        hidden || empty ? null : (
          <button
            type="button"
            onClick={() => avail.mutate({ p, to: out ? 'available' : 'sold_out_today' })}
            aria-label={out ? `${p.name}: voltar a vender` : `${p.name}: esgotado hoje`}
            className={cn(
              'press t-label mr-3 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5',
              lead ? 'bg-spark text-on-spark depth-1' : 'bg-sunken text-ink hover:bg-press',
            )}
          >
            {out ? (
              <ArrowCounterClockwise weight="bold" className="size-4" />
            ) : (
              <ProhibitInset weight="bold" className="size-4" />
            )}
            {out ? 'voltar' : 'esgotar'}
          </button>
        )
      }
    >
      <Lines
        title={p.name}
        sub={
          <>
            <span className="tnum">{money(p.priceCents)}</span>
            {out ? <span className="font-semibold text-danger"> · esgotado</span> : null}
            {hidden ? ' · escondido' : null}
            {empty ? <span className="font-semibold text-danger"> · sem estoque</span> : null}
          </>
        }
      />
    </Hit>
  );
}

function ActionHit({ e, onClick }: { e: ActionEntry; onClick: () => void }) {
  const I = ACTION_ICON[e.id];
  return (
    <Hit onClick={onClick} icon={<I weight="bold" className="size-5" />} tone="action">
      <Lines title={e.label} sub={e.hint} />
    </Hit>
  );
}

function Lines({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-semibold">{title}</span>
      {sub ? <span className="t-caption block truncate text-muted">{sub}</span> : null}
    </span>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="t-caption mb-1.5 px-1 font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      <ul className="overflow-hidden rounded-md ring-1 ring-line">{children}</ul>
    </section>
  );
}

function Hit({
  children,
  onClick,
  icon,
  trail,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  icon: ReactNode;
  /** a second tap target beside the row (esgotar, WhatsApp), outside its button */
  trail?: ReactNode;
  tone?: 'action' | 'spark';
}) {
  return (
    <li className="flex items-center border-b border-line last:border-0">
      <button
        type="button"
        data-hit
        onClick={onClick}
        className="press-row flex min-h-16 min-w-0 flex-1 items-center gap-3 px-3 text-left hover:bg-hover focus-visible:bg-hover"
      >
        <span
          className={cn(
            'grid size-10 shrink-0 place-items-center',
            tone === 'action'
              ? 'rounded-full bg-sunken text-ink'
              : tone === 'spark'
                ? 'rounded-full bg-spark text-on-spark'
                : 'text-muted',
          )}
        >
          {icon}
        </span>
        {children}
      </button>
      {trail}
    </li>
  );
}
