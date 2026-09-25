import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Download,
  Keyboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SunMoon,
} from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { useStoredState } from '@/lib/hooks.ts';
import { useBadges, useLlmDriver } from '@/lib/queries.ts';
import { THEME_LABEL, useTheme } from '@/lib/theme.ts';
import { CountDot } from '@/components/ui/badge.tsx';
import { Kbd, Tooltip } from '@/components/ui/controls.tsx';
import { Dialog } from '@/components/ui/overlay.tsx';
import { CONFIG, HUBS, SHORTCUTS, type Hub } from './nav.ts';
import { CommandPalette } from './CommandPalette.tsx';
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
      const hub = [...HUBS, CONFIG].find((h) => h.k === e.key);
      if (hub) {
        e.preventDefault();
        nav(hub.to);
      }
    },
    [nav],
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
      <div className="flex h-full max-md:h-vv max-md:flex-col">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
          badges={badges}
          shell={shell}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col max-md:pt-safe max-md:px-safe">
          {children}
        </main>
        <TabBar badges={badges} />
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Dialog open={helpOpen} onOpenChange={setHelpOpen} title="atalhos">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-border-strong px-1.5 font-mono text-xs">
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

function Sidebar({
  collapsed,
  onToggle,
  badges,
  shell,
}: {
  collapsed: boolean;
  onToggle: () => void;
  badges: Record<string, number>;
  shell: ShellApi;
}) {
  const theme = useTheme();
  // md–lg is always the icon rail; lg+ follows the stored preference
  const wide = !collapsed;
  const label = wide ? 'hidden lg:inline' : 'hidden';
  const item =
    'group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground [&_svg]:size-4 [&_svg]:shrink-0';

  const link = (h: Hub) => {
    const n = h.badge ? (badges[h.badge] ?? 0) : 0;
    return (
      <Tooltip key={h.to} content={wide ? null : h.label} side="right">
        <NavLink
          to={h.to}
          end={h.to === '/'}
          className={({ isActive }) =>
            cn(
              item,
              isActive &&
                'bg-sidebar-accent text-sidebar-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-agent',
            )
          }
        >
          <h.icon />
          <span className={cn(label, 'flex-1')}>{h.label}</span>
          {n > 0 && (
            <CountDot n={n} className={cn(wide ? 'lg:static' : '', 'absolute top-0.5 right-0.5')} />
          )}
          <span className={cn(wide ? 'hidden lg:group-hover:inline' : 'hidden')}>
            <Kbd className="border-sidebar-border text-sidebar-muted">{h.k}</Kbd>
          </span>
        </NavLink>
      </Tooltip>
    );
  };

  const action = (icon: ReactNode, text: string, onClick: () => void) => (
    <Tooltip key={text} content={wide ? null : text} side="right">
      <button type="button" className={cn(item, 'w-full text-left')} onClick={onClick}>
        {icon}
        <span className={cn(label, 'truncate')}>{text}</span>
      </button>
    </Tooltip>
  );

  return (
    <nav
      aria-label="navegação"
      className={cn(
        'hidden shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground md:flex',
        wide ? 'w-14 lg:w-52' : 'w-14',
      )}
    >
      <div className="mb-2 flex h-8 items-center px-2">
        <span className="font-serif text-xl leading-none italic">
          v<span className={label}>enduá</span>
        </span>
        <span
          className={cn(
            label,
            'ml-1.5 font-mono text-[10px] tracking-[0.12em] text-agent uppercase',
          )}
        >
          controle
        </span>
      </div>
      {action(<Search />, 'buscar  ⌘K', shell.openPalette)}
      <div className="my-1.5 h-px bg-sidebar-border" />
      {HUBS.map(link)}
      <div className="mt-auto flex flex-col gap-0.5">
        <div className={cn(label, 'truncate px-2 pb-1 font-mono text-[10px] text-sidebar-muted')}>
          agente · {shell.llmDriver || '…'}
        </div>
        {link(CONFIG)}
        {action(<SunMoon />, `tema: ${THEME_LABEL[theme.pref]}`, theme.cycle)}
        {shell.install && action(<Download />, 'instalar app', shell.install)}
        {action(<Keyboard />, 'atalhos', shell.openHelp)}
        {action(<LogOut />, 'sair', shell.logout)}
        <button
          type="button"
          onClick={onToggle}
          className={cn(item, 'hidden lg:flex')}
          aria-label={wide ? 'recolher menu' : 'expandir menu'}
        >
          {wide ? <PanelLeftClose /> : <PanelLeftOpen />}
          <span className={label}>recolher</span>
        </button>
      </div>
    </nav>
  );
}

function TabBar({ badges }: { badges: Record<string, number> }) {
  return (
    <nav
      aria-label="seções"
      className="pb-safe px-safe flex shrink-0 border-t border-sidebar-border bg-sidebar md:hidden"
    >
      {HUBS.map((h) => {
        const n = h.badge ? (badges[h.badge] ?? 0) : 0;
        return (
          <NavLink
            key={h.to}
            to={h.to}
            end={h.to === '/'}
            className={({ isActive }) =>
              cn(
                'relative flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium tracking-wide text-sidebar-muted',
                isActive && 'text-sidebar-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                    isActive && 'bg-sidebar-accent text-agent',
                  )}
                >
                  <h.icon className="size-5" />
                </span>
                {h.label}
                {n > 0 && <CountDot n={n} className="absolute top-1.5 left-[calc(50%+6px)]" />}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
