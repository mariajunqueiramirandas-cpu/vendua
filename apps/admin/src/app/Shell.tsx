import {
  CaretLeft,
  CaretUpDown,
  DotsNine,
  Lock,
  MagnifyingGlass,
  SignOut,
  WifiSlash,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { StatusPill } from '../features/store/StatusPill.tsx';
import { api } from '../lib/api.ts';
import {
  setAnnouncer,
  useLiveState,
  useLiveStream,
  setSoundOn,
  usePendingWrites,
  usePollWhenOffline,
} from '../lib/live.ts';
import { applyUpdate, onUpdate, setBadge, updateReady } from '../lib/pwa.ts';
import { qk } from '../lib/query.ts';
import { can, featureOpen, ROLE_LABEL, useSession } from '../lib/session.ts';
import { setVolume, unlockAudio } from '../lib/sound.ts';
import { Boundary } from '../ui/Boundary.tsx';
import { cn } from '../ui/cn.ts';
import { Loading } from '../ui/feedback.tsx';
import { onHelp } from '../ui/help.ts';
import { toast, Toaster } from '../ui/Toast.tsx';
import { moreOf, navFor } from './nav.ts';
import { chunks, intent, screen, warmUp } from './routes.ts';
import { useScrollMemory, useTabNav } from './nativeFeel.ts';
import { useKeyboard } from '../ui/keyboard.ts';
import { placeOf } from './nav.ts';
import { useBack } from './Router.tsx';
import { PullToRefresh } from './PullToRefresh.tsx';

// screen-shaped skeletons: their own chunk, asked for as the shell loads (first paint stays light)
const RouteSkeleton = screen(chunks.skeletons, (m) => m.default);
void chunks.skeletons().catch(() => undefined);
const SearchSheet = screen(chunks.search, (m) => m.SearchSheet);
const MoreSheet = screen(chunks.sheets, (m) => m.MoreSheet);
const SwitchStoreSheet = screen(chunks.sheets, (m) => m.SwitchStoreSheet);
const HelpSheet = lazy(() => import('../features/help/HelpSheet.tsx'));
const Banner = lazy(() => import('../features/help/Banner.tsx'));

/** true once `open` has been true: keeps a lazy sheet mounted so it can animate closed */
function useSeen(open: boolean) {
  const [seen, setSeen] = useState(open);
  useEffect(() => {
    if (open) setSeen(true);
  }, [open]);
  return seen;
}
import { StoreAvatar } from './StoreAvatar.tsx';
import { resetClient } from '../lib/persist.ts';

function usePlacedCount() {
  // orders are pushed over the stream; a slow safety net stays for the one screen that can't miss
  const poll = usePollWhenOffline(30_000, 5 * 60_000);
  const { data } = useQuery({ queryKey: qk.board, queryFn: api.board, refetchInterval: poll });
  return data?.orders.filter((o) => o.state === 'placed').length ?? 0;
}

export function Shell({ children }: { children: ReactNode }) {
  const session = useSession();
  const role = session.user.role;
  const vendedorOn = !!session.vendedor?.enabled;
  const waiting = session.vendedor?.waiting ?? 0;
  const items = navFor(vendedorOn).filter((n) => can(role, n.min));
  const primary = items.filter((n) => n.primary);
  const more = moreOf(items, vendedorOn);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpSeen = useSeen(helpOpen);
  useEffect(() => onHelp(() => setHelpOpen(true)), []);
  const moreSeen = useSeen(moreOpen);
  const searchSeen = useSeen(searchOpen);
  const placed = usePlacedCount();
  useEffect(() => setBadge(placed + waiting), [placed, waiting]);
  const live = useLiveState();
  const pending = usePendingWrites();
  const loc = useLocation();
  const nav = useNavigate();
  const liveRegion = useRef<HTMLDivElement>(null);
  // the kitchen screens own the whole display: no rail, bars or pull-to-refresh, their own keys
  // (locked by the plan, the kitchen is an ordinary page: the lock is the upsell)
  const kitchen = loc.pathname.startsWith('/cozinha') && featureOpen(session, 'kds');
  // Duá's onboarding is a journey with its own header, like /bem-vindo, but it keeps
  // the live stream (the interviewer's replies arrive on it)
  const bare = kitchen || loc.pathname === '/vendedor/comecar';
  const bareRef = useRef(kitchen);
  bareRef.current = kitchen;
  useEffect(() => {
    if (!bare) return;
    document.documentElement.dataset.bare = '';
    return () => void delete document.documentElement.dataset.bare;
  }, [bare]);

  useLiveStream(true);
  useScrollMemory();
  useKeyboard();
  const qc = useQueryClient();
  const allowed = items.map((n) => n.to).join(' ');
  useEffect(() => warmUp(allowed.split(' ')), [allowed]);
  const tab = useTabNav();
  useEffect(() => {
    setSoundOn(session.user.prefs.sound !== false);
    setVolume(session.user.prefs.volume ?? 0.8);
  }, [session.user.prefs.sound, session.user.prefs.volume]);
  useEffect(() => {
    setAnnouncer((t) => {
      if (liveRegion.current) liveRegion.current.textContent = t;
    });
    // browsers only allow sound after a gesture — any first tap arms it
    const arm = () => unlockAudio();
    window.addEventListener('pointerdown', arm, { once: true });
    return () => window.removeEventListener('pointerdown', arm);
  }, []);
  useEffect(() => {
    // "/" searches, "?" is help — never while typing
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey || bareRef.current) return;
      if (e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    // a tapped notification, an app shortcut or a relaunch (lib/pwa.ts)
    const onOpen = (e: Event) => {
      const url = (e as CustomEvent<string>).detail;
      nav(url.replace(/^\/admin/, '') || '/');
    };
    window.addEventListener('vendua:open', onOpen);
    return () => window.removeEventListener('vendua:open', onOpen);
  }, [nav]);
  useEffect(() => {
    const announce = () =>
      toast('Tem uma versão nova do app.', {
        tone: 'info',
        ms: 24 * 60 * 60_000,
        action: { label: 'atualizar', run: applyUpdate },
      });
    if (updateReady()) announce();
    return onUpdate(announce);
  }, []);
  useEffect(() => setMoreOpen(false), [loc.pathname]);

  const badge = (to: string) =>
    to === '/pedidos' ? placed : to === '/vendedor' && vendedorOn ? waiting : 0;

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#conteudo"
        className="t-label fixed left-3 top-3 z-[90] -translate-y-20 rounded-md bg-primary px-4 py-3 text-on-primary focus:translate-y-0"
      >
        pular para o conteúdo
      </a>

      {/* tablet rail + desktop sidebar */}
      <aside
        className={cn(
          'vt-rail sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-bg md:flex md:w-[88px] lg:w-[264px]',
          bare && 'hidden!',
        )}
      >
        <div className="flex flex-col items-center gap-3 px-3 pb-2 pt-5 lg:items-stretch lg:px-4">
          <StoreSwitcher />
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="t-body flex h-11 w-11 items-center justify-center gap-2 rounded-md text-muted ring-1 ring-line hover:bg-hover lg:w-full lg:justify-start lg:px-3"
            aria-label="buscar"
          >
            <MagnifyingGlass className="size-5 shrink-0" />
            <span className="hidden flex-1 text-left lg:inline">Buscar</span>
            <kbd className="t-caption hidden rounded bg-sunken px-1.5 lg:inline">/</kbd>
          </button>
        </div>
        <nav aria-label="principal" className="flex-1 overflow-y-auto px-3 py-2 lg:px-4">
          <ul className="space-y-1">
            {items.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  onClick={tab(n.to)}
                  {...intent(qc, n.to)}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 transition-colors lg:flex-row lg:justify-start lg:gap-3 lg:px-3',
                      isActive
                        ? 'bg-surface text-ink depth-1'
                        : 'text-muted hover:bg-hover hover:text-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <n.Icon
                        weight="duotone"
                        className={cn(
                          'size-6 shrink-0',
                          isActive && '[&_*[opacity]]:fill-(--spark) [&_*[opacity]]:opacity-100',
                        )}
                      />
                      <span className="t-caption text-center leading-tight lg:t-body lg:font-semibold">
                        {n.label}
                      </span>
                      {badge(n.to) ? (
                        <NavBadge
                          n={badge(n.to)}
                          to={n.to}
                          className="absolute right-2 top-1 lg:static lg:ml-auto"
                        />
                      ) : n.feature && !featureOpen(session, n.feature) ? (
                        <NavLock className="absolute right-2 top-1.5 lg:static lg:ml-auto" />
                      ) : null}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="space-y-2 border-t border-line p-3 lg:p-4">
          <StatusPill block rail />
          <UserMenu />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* phone top: status pill always visible (§3.2) + search */}
        <header
          className={cn(
            'vt-top chrome sticky top-0 z-30 flex items-center gap-2 bg-bg/95 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-sm md:hidden kb:static',
            bare && 'hidden!',
          )}
        >
          {placeOf(loc.pathname)?.depth ? (
            <BackButton pathname={loc.pathname} />
          ) : (
            <StoreAvatar size={40} />
          )}
          <span className="vt-pill flex min-w-0">
            <StatusPill className="min-w-0" />
          </span>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="buscar"
            onClick={() => setSearchOpen(true)}
            onPointerDown={() => void chunks.search().catch(() => undefined)}
            className="press grid size-12 shrink-0 place-items-center rounded-full"
          >
            <MagnifyingGlass className="size-6" />
          </button>
        </header>

        {!live.online && !kitchen ? (
          <div
            role="status"
            className="t-body sticky top-0 z-40 flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-warning md:top-0 kb:static"
          >
            <WifiSlash className="size-5 shrink-0" aria-hidden />
            <span>
              Sem conexão, tentando de novo.
              {pending
                ? ` ${pending === 1 ? '1 ação esperando' : `${pending} ações esperando`} conexão.`
                : ' O que você fizer agora é enviado quando voltar.'}
            </span>
          </div>
        ) : null}

        <IncidentBanner />

        <main id="conteudo" tabIndex={-1} className="outline-none">
          <Boundary resetKey={loc.pathname}>
            <Suspense
              fallback={
                <Suspense
                  fallback={<Loading delay={0} className="mx-auto max-w-[880px] p-4 md:p-8" />}
                >
                  <RouteSkeleton pathname={loc.pathname} />
                </Suspense>
              }
            >
              {children}
            </Suspense>
          </Boundary>
        </main>
      </div>

      {/* phone bottom bar: five items, always labelled (§3.1) */}
      <nav
        aria-label="principal"
        className={cn(
          'vt-tabs chrome glass pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line md:hidden',
          bare && 'hidden!',
        )}
      >
        <ul className="mx-auto flex max-w-lg">
          {primary.map((n) => (
            <li key={n.to} className="flex-1">
              <NavLink
                to={n.to}
                end={n.to === '/'}
                onClick={tab(n.to)}
                {...intent(qc, n.to)}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-[72px] flex-col items-center justify-center gap-1',
                    isActive ? 'text-ink' : 'text-muted',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        'grid h-8 w-14 place-items-center rounded-full transition-colors',
                        isActive && 'bg-spark-soft',
                      )}
                    >
                      <n.Icon weight={isActive ? 'fill' : 'duotone'} className="size-6" />
                    </span>
                    <span className={cn('t-caption', isActive && 'font-bold')}>{n.label}</span>
                    {badge(n.to) ? (
                      <NavBadge
                        n={badge(n.to)}
                        to={n.to}
                        className="absolute left-1/2 top-2 ml-2"
                      />
                    ) : null}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          {more.length ? (
            <li className="flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                onPointerDown={() => void chunks.sheets().catch(() => undefined)}
                className={cn(
                  'flex h-[72px] w-full flex-col items-center justify-center gap-1',
                  moreOpen ? 'text-ink' : 'text-muted',
                )}
                aria-haspopup="dialog"
              >
                <span className="grid h-8 w-14 place-items-center rounded-full">
                  <DotsNine weight="duotone" className="size-6" />
                </span>
                <span className="t-caption">Mais</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>

      {/* sheets load on first open — vaul/radix stay out of the first paint */}
      <Suspense fallback={null}>
        {moreOpen || moreSeen ? (
          <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} items={more} />
        ) : null}
        {searchOpen || searchSeen ? (
          <SearchSheet open={searchOpen} onOpenChange={setSearchOpen} />
        ) : null}
        {helpOpen || helpSeen ? <HelpSheet open={helpOpen} onOpenChange={setHelpOpen} /> : null}
      </Suspense>
      {bare ? null : <PullToRefresh />}
      <Toaster />
      <div ref={liveRegion} aria-live="assertive" className="sr-only" />
    </div>
  );
}

/**
 * A platform problem that stops orders or payments (set by Venduá staff) shows on every screen
 * while it lasts. The query lives here; the banner's code loads only when there is one.
 */
function IncidentBanner() {
  const { data } = useQuery({
    queryKey: qk.helpStatus,
    queryFn: api.helpStatus,
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
  });
  const loc = useLocation();
  const live = data?.incidents.some((i) => !i.resolvedAt && i.severity !== 'info');
  if (!live || loc.pathname === '/ajuda') return null;
  return (
    <Suspense fallback={null}>
      <Banner incidents={data!.incidents} />
    </Suspense>
  );
}

/** Phones, one level down: where the store avatar sits, "‹ Pedidos" goes back (§3.3). */
function BackButton({ pathname }: { pathname: string }) {
  const { label, back } = useBack(pathname);
  return (
    <button
      type="button"
      onClick={back}
      aria-label={`voltar para ${label}`}
      className="press -ml-2 flex h-12 min-w-12 max-w-[9.5rem] shrink-0 items-center gap-0.5 rounded-full pl-1 pr-3 text-ink"
    >
      <CaretLeft weight="bold" className="size-6 shrink-0" aria-hidden />
      <span className="t-label truncate">{label}</span>
    </button>
  );
}

function NavBadge({ n, to, className }: { n: number; to: string; className?: string }) {
  return (
    <span
      key={n}
      aria-label={
        to === '/vendedor' ? `${n} precisa${n === 1 ? '' : 'm'} de você` : `${n} esperando`
      }
      className={cn(
        'animate-pop tnum grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[0.75rem] font-bold ring-2 ring-bg',
        // a shopper waiting on a person "needs you"; new orders are alive
        to === '/vendedor' ? 'bg-warning text-surface' : 'bg-spark text-on-spark',
        className,
      )}
    >
      {n}
    </span>
  );
}

function StoreSwitcher() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const multi = s.stores.length > 1;
  return (
    <>
      <button
        type="button"
        onClick={() => multi && setOpen(true)}
        className={cn(
          'flex items-center gap-3 rounded-md p-1 text-left lg:p-2',
          multi && 'hover:bg-hover',
        )}
        aria-label={multi ? `loja: ${s.store.name}. trocar de loja` : s.store.name}
      >
        <StoreAvatar size={44} />
        <span className="hidden min-w-0 flex-1 lg:block">
          <span className="block truncate font-semibold">{s.store.name}</span>
          <span className="t-caption block truncate text-muted">
            {s.store.url.replace('https://', '')}
          </span>
        </span>
        {multi ? <CaretUpDown className="hidden size-5 text-muted lg:block" aria-hidden /> : null}
      </button>
      {open ? (
        <Suspense fallback={null}>
          <SwitchStoreSheet open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </>
  );
}

export function UserMenu() {
  const s = useSession();
  const qc = useQueryClient();
  return (
    <div className="flex items-center gap-2">
      <NavLink
        to="/perfil"
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-md px-2 hover:bg-hover md:justify-center lg:justify-start"
        aria-label={`seu perfil: ${s.user.name}`}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken font-display font-semibold">
          {s.user.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 md:hidden lg:block">
          <span className="block truncate font-semibold">{s.user.name}</span>
          <span className="t-caption block text-muted">{ROLE_LABEL[s.user.role]}</span>
        </span>
      </NavLink>
      <button
        type="button"
        aria-label="sair"
        title="sair"
        onClick={async () => {
          await api.auth.logout().catch(() => undefined);
          await resetClient(qc);
          window.location.assign('/admin/entrar');
        }}
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink md:hidden lg:grid"
      >
        <SignOut className="size-5" />
      </button>
    </div>
  );
}

/** A screen the plan doesn't open: still a link (the screen shows the plan that has it). */
export function NavLock({ className, quiet }: { className?: string; quiet?: boolean }) {
  return (
    <span className={cn('text-faint', className)}>
      <Lock weight="fill" className="size-3.5" aria-hidden />
      {quiet ? null : <span className="sr-only">, fora do seu plano</span>}
    </span>
  );
}
