import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  CalendarDays,
  CheckSquare,
  Download,
  FlaskConical,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  SlidersHorizontal,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from './api.ts';
import { onControlEvent } from './events.ts';
import Login from './views/Login.tsx';
import Dashboard from './views/Dashboard.tsx';
import BoardView from './views/Board.tsx';
import Leads from './views/Leads.tsx';
import LeadDetail from './views/LeadDetail.tsx';
import InboxView from './views/Inbox.tsx';
import Approvals from './views/Approvals.tsx';
import Discovery from './views/Discovery.tsx';
import Tasks from './views/Tasks.tsx';
import Plan from './views/Plan.tsx';
import Runs from './views/Runs.tsx';
import Reports from './views/Reports.tsx';
import Calendar from './views/Calendar.tsx';
import Settings from './views/Settings.tsx';
import AgentStudio from './views/AgentStudio.tsx';

const NAV = [
  { to: '/', label: 'Painel', icon: LayoutDashboard, k: 'd' },
  { to: '/funil', label: 'Funil', icon: KanbanSquare, k: 'f' },
  { to: '/leads', label: 'Leads', icon: Users, k: 'l' },
  { to: '/inbox', label: 'Inbox', icon: Inbox, k: 'i' },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, k: 'j' },
  { to: '/aprovacoes', label: 'Aprovações', icon: CheckSquare, k: 'a', badge: 'drafts' },
  { to: '/descoberta', label: 'Descoberta', icon: FlaskConical, k: 'e' },
  { to: '/tarefas', label: 'Tarefas', icon: ListTodo, k: 't', badge: 'tasks' },
  { to: '/agente', label: 'Agente', icon: Bot, k: 'g' },
  { to: '/estudio', label: 'Estúdio', icon: SlidersHorizontal, k: 's' },
  { to: '/plano', label: 'Planos', icon: ListChecks, k: 'p' },
  { to: '/relatorios', label: 'Relatórios', icon: TrendingUp, k: 'r' },
  { to: '/config', label: 'Config', icon: SettingsIcon, k: 'c' },
] as const;

// Phone shell: daily-desk destinations become bottom tabs; the rest go in the menu sheet.
const TAB_PATHS = new Set<string>(['/', '/funil', '/leads', '/inbox']);
const TABS = NAV.filter((n) => TAB_PATHS.has(n.to));
const MORE = NAV.filter((n) => !TAB_PATHS.has(n.to));

// beforeinstallprompt isn't in lib.dom — Chrome/Android only; on iOS the
// button simply never renders.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SHORTCUTS: [string, string][] = [
  ['d f l i j a e t g s p r c', 'trocar de tela'],
  ['/', 'buscar (em leads)'],
  ['n', 'novo lead (em leads)'],
  ['ctrl + enter', 'enviar mensagem (no inbox)'],
  ['shift + ctrl + enter', 'salvar rascunho (no inbox)'],
  ['?', 'esta ajuda'],
];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [badges, setBadges] = useState<{ drafts: number; tasks: number }>({
    drafts: 0,
    tasks: 0,
  });
  const [llmDriver, setLlmDriver] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => setNavOpen(false), [loc.pathname]);

  // Dismiss the phone menu sheet when the viewport widens past the CSS breakpoint.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const close = () => {
      if (!mq.matches) setNavOpen(false);
    };
    mq.addEventListener('change', close);
    return () => mq.removeEventListener('change', close);
  }, []);

  // beforeinstallprompt only fires when installable — the button is its own detection.
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

  const install = installEvt
    ? () => {
        const e = installEvt;
        setInstallEvt(null); // one-shot: the event can't be prompted twice
        void e.prompt();
      }
    : undefined;

  useEffect(() => {
    api
      .session()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (!authed) return;
    const tick = () =>
      api
        .stats()
        .then((s) => setBadges({ drafts: s.pendingDrafts, tasks: s.openTasks }))
        .catch(() => undefined);
    tick();
    const off = onControlEvent(['draft.change', 'lead.change'], tick);
    const t = setInterval(tick, 60_000);
    api
      .integrations()
      .then((r) =>
        setLlmDriver(r.integrations.find((i) => i.kind === 'llm' && i.enabled)?.driver ?? 'off'),
      )
      .catch(() => undefined);
    return () => {
      off();
      clearInterval(t);
    };
  }, [authed]);

  // Bare-letter nav keys; ignored while typing.
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?' || e.key === 'Escape') {
        setShowHelp(e.key === '?');
        setNavOpen(false);
        return;
      }
      const item = NAV.find((n) => n.k === e.key);
      if (item) {
        e.preventDefault();
        nav(item.to);
      }
    },
    [nav],
  );
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  if (authed === null) return null;
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const logout = async () => {
    await api.logout().catch(() => undefined);
    setAuthed(false);
  };

  return (
    <div className="shell">
      <nav className="rail">
        <div className="brand">
          venduá <em>controle</em>
        </div>
        {NAV.map((n) => {
          const count = 'badge' in n ? badges[n.badge] : 0;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <n.icon /> {n.label}
              {count > 0 && <span className="nb">{count}</span>}
              <span className="kbd">{n.k}</span>
            </NavLink>
          );
        })}
        <RailFoot
          llmDriver={llmDriver}
          onHelp={() => setShowHelp(true)}
          onLogout={logout}
          onInstall={install}
        />
      </nav>
      <div className="main">
        <Routes key={loc.pathname}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/funil" element={<BoardView />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/leads/:id" element={<LeadDetail />} />
          <Route path="/inbox" element={<InboxView />} />
          <Route path="/inbox/:threadId" element={<InboxView />} />
          <Route path="/agenda" element={<Calendar />} />
          <Route path="/aprovacoes" element={<Approvals />} />
          <Route path="/descoberta" element={<Discovery />} />
          {/* legacy: the launch screen merged into Descoberta — keep ?run= deep links working */}
          <Route path="/lancar" element={<Discovery />} />
          <Route path="/tarefas" element={<Tasks />} />
          <Route path="/agente" element={<Runs />} />
          <Route path="/agente/runs/:id" element={<Runs />} />
          <Route path="/estudio" element={<AgentStudio />} />
          <Route path="/plano" element={<Plan />} />
          <Route path="/relatorios" element={<Reports />} />
          <Route path="/config" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <nav className="tabbar" aria-label="seções">
        {TABS.map((n) => {
          const count = 'badge' in n ? badges[n.badge] : 0;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
            >
              <n.icon />
              <span>{n.label}</span>
              {count > 0 && <span className="nb">{count}</span>}
            </NavLink>
          );
        })}
        <button
          type="button"
          className={`tab${navOpen ? ' active' : ''}`}
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
        >
          <Menu />
          <span>menu</span>
          {badges.drafts + badges.tasks > 0 && (
            <span className="nb">{badges.drafts + badges.tasks}</span>
          )}
        </button>
      </nav>
      {navOpen && (
        <div className="scrim sheet" onClick={() => setNavOpen(false)}>
          <div
            className="msheet"
            role="dialog"
            aria-label="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="msheet-grip" />
            {MORE.map((n) => {
              const count = 'badge' in n ? badges[n.badge] : 0;
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  onClick={() => setNavOpen(false)}
                >
                  <n.icon /> {n.label}
                  {count > 0 && <span className="nb">{count}</span>}
                </NavLink>
              );
            })}
            <RailFoot
              llmDriver={llmDriver}
              onHelp={() => {
                setNavOpen(false);
                setShowHelp(true);
              }}
              onLogout={logout}
              onInstall={install}
            />
          </div>
        </div>
      )}
      {showHelp && (
        <div className="scrim" onClick={() => setShowHelp(false)}>
          <div className="m-card" onClick={(e) => e.stopPropagation()}>
            <h2>atalhos</h2>
            <div className="m-keys">
              {SHORTCUTS.map(([k, d]) => (
                <span key={k} style={{ display: 'contents' }}>
                  <span className="kbd">{k}</span>
                  <span>{d}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RailFoot({
  llmDriver,
  onHelp,
  onLogout,
  onInstall,
}: {
  llmDriver: string;
  onHelp: () => void;
  onLogout: () => void;
  onInstall: (() => void) | undefined;
}) {
  return (
    <div className="rail-foot">
      <span>agente · {llmDriver || '…'}</span>
      {onInstall && (
        <button className="btn ghost" onClick={onInstall}>
          <Download size={14} /> instalar app
        </button>
      )}
      <button className="btn ghost" onClick={onHelp}>
        <span className="kbd">?</span> atalhos
      </button>
      <button className="btn ghost" onClick={onLogout}>
        <LogOut size={14} /> sair
      </button>
    </div>
  );
}
