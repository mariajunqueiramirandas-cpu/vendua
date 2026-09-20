import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  CheckSquare,
  Crosshair,
  FlaskConical,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';
import { api, ApiError } from './api.ts';
import Login from './views/Login.tsx';
import Dashboard from './views/Dashboard.tsx';
import BoardView from './views/Board.tsx';
import Leads from './views/Leads.tsx';
import LeadDetail from './views/LeadDetail.tsx';
import InboxView from './views/Inbox.tsx';
import Approvals from './views/Approvals.tsx';
import Discovery from './views/Discovery.tsx';
import Tasks from './views/Tasks.tsx';
import Runs from './views/Runs.tsx';
import Launch from './views/Launch.tsx';
import Settings from './views/Settings.tsx';

const NAV = [
  { to: '/', label: 'Painel', icon: LayoutDashboard, k: 'd' },
  { to: '/funil', label: 'Funil', icon: KanbanSquare, k: 'f' },
  { to: '/leads', label: 'Leads', icon: Users, k: 'l' },
  { to: '/inbox', label: 'Inbox', icon: Inbox, k: 'i' },
  { to: '/aprovacoes', label: 'Aprovações', icon: CheckSquare, k: 'a', badge: 'drafts' },
  { to: '/lancar', label: 'Lançar', icon: Crosshair, k: 'x' },
  { to: '/descoberta', label: 'Descoberta', icon: FlaskConical, k: 'e' },
  { to: '/tarefas', label: 'Tarefas', icon: ListTodo, k: 't', badge: 'tasks' },
  { to: '/agente', label: 'Agente', icon: Bot, k: 'g' },
  { to: '/config', label: 'Config', icon: SettingsIcon, k: 'c' },
] as const;

// Phone shell: the daily-desk destinations become bottom tabs; everything
// else lives in the slide-up "menu" sheet.
const TAB_PATHS = new Set<string>(['/', '/funil', '/leads', '/inbox']);
const TABS = NAV.filter((n) => TAB_PATHS.has(n.to));
const MORE = NAV.filter((n) => !TAB_PATHS.has(n.to));

const SHORTCUTS: [string, string][] = [
  ['d f l i a x e t g c', 'trocar de tela'],
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
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => setNavOpen(false), [loc.pathname]);

  useEffect(() => {
    api
      .session()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  // Rail badges + footer: what needs attention now, which brain is on.
  useEffect(() => {
    if (!authed) return;
    const tick = () =>
      api
        .stats()
        .then((s) => setBadges({ drafts: s.pendingDrafts, tasks: s.openTasks }))
        .catch(() => undefined);
    tick();
    const t = setInterval(tick, 30_000);
    api
      .integrations()
      .then((r) =>
        setLlmDriver(r.integrations.find((i) => i.kind === 'llm' && i.enabled)?.driver ?? 'off'),
      )
      .catch(() => undefined);
    return () => clearInterval(t);
  }, [authed]);

  // Keyboard-first: g+d/f/l/i/a/e/t/g/c navigate; only when not typing.
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
        <RailFoot llmDriver={llmDriver} onHelp={() => setShowHelp(true)} onLogout={logout} />
      </nav>
      <div className="main">
        <Routes key={loc.pathname}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/funil" element={<BoardView />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/leads/:id" element={<LeadDetail />} />
          <Route path="/inbox" element={<InboxView />} />
          <Route path="/inbox/:threadId" element={<InboxView />} />
          <Route path="/aprovacoes" element={<Approvals />} />
          <Route path="/descoberta" element={<Discovery />} />
          <Route path="/lancar" element={<Launch />} />
          <Route path="/tarefas" element={<Tasks />} />
          <Route path="/agente" element={<Runs />} />
          <Route path="/agente/runs/:id" element={<Runs />} />
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
}: {
  llmDriver: string;
  onHelp: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="rail-foot">
      <span>agente · {llmDriver || '…'}</span>
      <button
        className="btn ghost"
        style={{
          color: 'var(--rail-muted)',
          justifyContent: 'flex-start',
          padding: '4px 8px',
        }}
        onClick={onHelp}
      >
        <span className="kbd">?</span> atalhos
      </button>
      <button
        className="btn ghost"
        style={{ color: 'var(--rail-muted)', justifyContent: 'flex-start', padding: '4px 8px' }}
        onClick={onLogout}
      >
        <LogOut size={14} /> sair
      </button>
    </div>
  );
}

export { ApiError };
