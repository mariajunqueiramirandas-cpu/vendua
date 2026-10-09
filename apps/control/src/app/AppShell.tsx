import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useMatch, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  ChevronsUpDown,
  Download,
  Keyboard,
  LogOut,
  PanelLeft,
  Search,
  SquarePen,
  SunMoon,
} from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { useStoredState } from '@/lib/hooks.ts';
import { useBadges, useLlmDriver } from '@/lib/queries.ts';
import { THEME_LABEL, useTheme } from '@/lib/theme.ts';
import { CountDot } from '@/components/ui/badge.tsx';
import { Kbd, Tooltip } from '@/components/ui/controls.tsx';
import {
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlay.tsx';
import {
  CONFIG,
  HUBS,
  isSalesPath,
  SALES,
  SALES_GROUP,
  salesBadge,
  SHORTCUTS,
  type Hub,
} from './nav.ts';
import { useAttentionCount } from './attention.ts';
import { CommandPalette } from './CommandPalette.tsx';
import { Onboarding } from './Onboarding.tsx';
import { ShellContext, type ShellApi } from './shell-context.ts';

// Chrome/Android only — on iOS the install button never renders.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

export function AppShell({ onLogout, children }: { onLogout: () => void; children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [collapsed, setCollapsed] = useStoredState('vendua-control-rail', false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const badges = useBadges();
  useAttentionCount(badges.drafts + badges.overdue + badges.sites);
  const llmDriver = useLlmDriver();
  const nav = useNavigate();

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    const onDone = () => setInstallEvt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onDone);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onDone);
    };
  }, []);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        setCollapsed((v) => !v);
        return;
      }
      const el = e.target as HTMLElement;
      if (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') return setHelpOpen(true);
      if (e.key === '/') {
        e.preventDefault();
        return setPaletteOpen(true);
      }
      if (e.key === 'n') {
        e.preventDefault();
        return nav('/pipeline?novo=1');
      }
      const hub = [...HUBS, ...SALES, CONFIG].find((h) => h.k === e.key);
      if (hub) {
        e.preventDefault();
        nav(hub.to);
      }
    },
    [nav, setCollapsed],
  );
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  const shell = useMemo<ShellApi>(
    () => ({
      openPalette: () => setPaletteOpen(true),
      openHelp: () => setHelpOpen(true),
      logout: onLogout,
      install: installEvt
        ? () => {
            setInstallEvt(null); // the event can't be prompted twice
            void installEvt.prompt();
          }
        : undefined,
      llmDriver,
    }),
    [onLogout, installEvt, llmDriver],
  );

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-full bg-app max-md:h-vv max-md:flex-col">
        <Sidebar
          wide={!collapsed}
          onToggle={() => setCollapsed((v) => !v)}
          badges={badges}
          shell={shell}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col md:py-2 md:pr-2 max-md:bg-background max-md:pt-safe max-md:px-safe">
          <SalesSubNav badges={badges} />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-xl md:shadow-panel">
            {children}
          </div>
        </main>
        <TabBar badges={badges} />
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Onboarding />
      <Dialog open={helpOpen} onOpenChange={setHelpOpen} title="Atalhos de teclado">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs shadow-card">
                  {k}
                </kbd>
              </dt>
              <dd className="text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </ShellContext.Provider>
  );
}

export function BrandMark({ className }: { className?: string | undefined }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-primary font-serif text-[17px] leading-none text-agent italic shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] dark:bg-agent dark:text-agent-foreground',
        className,
      )}
    >
      v
    </span>
  );
}

function Sidebar({
  wide,
  onToggle,
  badges,
  shell,
}: {
  wide: boolean;
  onToggle: () => void;
  badges: Record<string, number>;
  shell: ShellApi;
}) {
  const theme = useTheme();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const inSales = isSalesPath(pathname);
  const [salesOpen, setSalesOpen] = useStoredState('vendua-control-sales-open', true);
  // entering the sales area opens the group; collapsing it there sticks until you leave
  useEffect(() => {
    if (inSales) setSalesOpen(true);
  }, [inSales, setSalesOpen]);
  const salesN = salesBadge(badges);
  // md–lg is always the icon rail; lg+ follows the stored preference
  const label = wide ? 'hidden lg:inline' : 'hidden';
  const item =
    'group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-nav-foreground transition-colors hover:bg-nav-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-nav-muted';
  const active =
    'bg-nav-active text-foreground shadow-card hover:bg-nav-active [&_svg]:text-foreground';
  const badgeCls = cn(
    'rounded-full bg-primary px-1.5 text-[10.5px] leading-4 font-semibold text-primary-foreground tnum',
    wide ? 'max-lg:absolute max-lg:top-0 max-lg:right-0' : 'absolute top-0 right-0',
  );

  const link = (h: Hub) => {
    const n = h.badge ? (badges[h.badge] ?? 0) : 0;
    return (
      <Tooltip key={h.to} content={wide ? null : h.label} side="right">
        <NavLink
          to={h.to}
          end={h.to === '/'}
          className={({ isActive }) =>
            cn(item, wide ? 'max-lg:justify-center' : 'justify-center', isActive && active)
          }
        >
          <h.icon />
          <span className={cn(label, 'flex-1')}>{h.label}</span>
          {n > 0 && <span className={badgeCls}>{n}</span>}
        </NavLink>
      </Tooltip>
    );
  };

  return (
    <nav
      aria-label="navegação"
      className={cn(
        'hidden shrink-0 flex-col gap-0.5 px-2 pt-3 pb-2 md:flex',
        wide ? 'w-14 lg:w-56' : 'w-14',
      )}
    >
      <div className={cn('mb-3 flex items-center gap-2 px-1', !wide && 'justify-center')}>
        <BrandMark />
        <span className={cn(label, 'flex-1 truncate text-sm font-semibold tracking-tight')}>
          venduá
        </span>
        <Tooltip content="novo lead  N" side="bottom">
          <button
            type="button"
            onClick={() => nav('/pipeline?novo=1')}
            className={cn(
              wide ? 'hidden lg:inline-flex' : 'hidden',
              'size-7 items-center justify-center rounded-md border bg-card text-nav-foreground shadow-card hover:bg-muted [&_svg]:size-3.5',
            )}
            aria-label="novo lead"
          >
            <SquarePen />
          </button>
        </Tooltip>
      </div>

      <Tooltip content={wide ? null : 'buscar  ⌘K'} side="right">
        <button
          type="button"
          onClick={shell.openPalette}
          className={cn(
            item,
            'mb-3 w-full',
            wide
              ? 'lg:border lg:bg-card lg:text-nav-muted lg:shadow-card lg:hover:bg-card max-lg:justify-center'
              : 'justify-center',
          )}
        >
          <Search />
          <span className={cn(label, 'flex-1 text-left font-normal')}>Buscar…</span>
          <span className={cn(wide ? 'hidden lg:inline' : 'hidden')}>
            <Kbd>⌘K</Kbd>
          </span>
        </button>
      </Tooltip>

      {HUBS.map(link)}

      <Tooltip content={wide ? null : 'Vendas'} side="right">
        <button
          type="button"
          aria-expanded={salesOpen}
          onClick={() => setSalesOpen((v) => !v)}
          className={cn(
            item,
            'mt-3 w-full',
            wide ? 'max-lg:justify-center' : 'justify-center',
            !salesOpen && inSales && active,
          )}
        >
          <SALES_GROUP.icon />
          <span className={cn(label, 'flex-1 text-left')}>{SALES_GROUP.label}</span>
          {!salesOpen && salesN > 0 && <span className={badgeCls}>{salesN}</span>}
          <ChevronRight
            className={cn(
              wide ? 'hidden lg:block' : 'hidden',
              'size-3.5! transition-transform motion-reduce:transition-none',
              salesOpen && 'rotate-90',
            )}
          />
        </button>
      </Tooltip>
      {salesOpen && (
        <div className={cn('flex flex-col gap-0.5', wide && 'lg:ml-[15px] lg:border-l lg:pl-1.5')}>
          {SALES.map(link)}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-0.5">
        {link(CONFIG)}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                item,
                'mt-1 h-10 w-full',
                wide ? 'max-lg:justify-center' : 'justify-center',
              )}
            >
              <span className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground">
                EQ
                <span
                  className={cn(
                    'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-app',
                    shell.llmDriver && shell.llmDriver !== 'off' ? 'bg-success' : 'bg-nav-muted',
                  )}
                />
              </span>
              <span className={cn(label, 'min-w-0 flex-1 text-left')}>
                <span className="block truncate text-[13px] leading-tight">Equipe</span>
                <span className="block truncate text-[11px] leading-tight font-normal text-nav-muted">
                  agente · {shell.llmDriver || '…'}
                </span>
              </span>
              <ChevronsUpDown className={cn(label)} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel>agente · {shell.llmDriver || '…'}</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                theme.cycle();
              }}
            >
              <SunMoon /> Tema: {THEME_LABEL[theme.pref]}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={shell.openHelp}>
              <Keyboard /> Atalhos
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggle} className="max-lg:hidden">
              <PanelLeft /> {wide ? 'Recolher menu' : 'Expandir menu'}
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">⌘.</span>
            </DropdownMenuItem>
            {shell.install && (
              <DropdownMenuItem onSelect={shell.install}>
                <Download /> Instalar app
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={shell.logout}>
              <LogOut /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}

function TabBar({ badges }: { badges: Record<string, number> }) {
  const { pathname } = useLocation();
  // an open conversation owns the bottom edge (composer above the keyboard)
  if (useMatch('/inbox/:threadId')) return null;
  const inSales = isSalesPath(pathname);
  const tab = (
    h: { to: string; label: string; icon: Hub['icon'] },
    n: number,
    on?: boolean | undefined,
  ) => (
    <NavLink
      key={h.to}
      to={h.to}
      end={h.to === '/'}
      className={({ isActive }) =>
        cn(
          'relative flex h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium text-nav-muted transition-colors',
          (on ?? isActive) && 'text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <h.icon className="size-[22px]" strokeWidth={(on ?? isActive) ? 2.1 : 1.6} />
          {h.label}
          {n > 0 && (
            <span className="absolute top-1 left-[calc(50%+5px)] min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] leading-4 font-semibold text-white tnum">
              {n}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
  return (
    <nav
      aria-label="seções"
      className="pb-safe px-safe flex shrink-0 border-t bg-background/85 backdrop-blur-xl backdrop-saturate-150 md:hidden kb:hidden"
    >
      {HUBS.map((h) => tab(h, h.badge ? (badges[h.badge] ?? 0) : 0))}
      {tab(SALES_GROUP, salesBadge(badges), inSales)}
    </nav>
  );
}

/** Phones: the sales hubs share one tab, so the shell puts their switcher above the page. */
function SalesSubNav({ badges }: { badges: Record<string, number> }) {
  const { pathname } = useLocation();
  const lead = useMatch('/pipeline/:id');
  const thread = useMatch('/inbox/:threadId');
  const run = useMatch('/agente/atividade/:id');
  const detail =
    !!thread || !!run || (!!lead && !['relatorios', 'analytics'].includes(lead.params.id ?? ''));
  if (!isSalesPath(pathname) || detail) return null;
  return (
    <nav
      aria-label="vendas"
      className="no-scrollbar flex shrink-0 overflow-x-auto border-b px-1.5 md:hidden kb:hidden"
    >
      {SALES.map((h) => {
        const n = h.badge ? (badges[h.badge] ?? 0) : 0;
        return (
          <NavLink
            key={h.to}
            to={h.to}
            className="group inline-flex h-11 shrink-0 items-center px-0.5"
          >
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors group-aria-[current=page]:bg-secondary group-aria-[current=page]:text-foreground">
              {h.label}
              <CountDot n={n} />
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}
