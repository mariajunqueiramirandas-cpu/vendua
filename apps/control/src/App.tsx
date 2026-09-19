import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  CheckSquare,
  FlaskConical,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListTodo,
  LogOut,
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
import Settings from './views/Settings.tsx';

const NAV = [
  { to: '/', label: 'Painel', icon: LayoutDashboard, k: 'd' },
  { to: '/funil', label: 'Funil', icon: KanbanSquare, k: 'f' },
  { to: '/leads', label: 'Leads', icon: Users, k: 'l' },
  { to: '/inbox', label: 'Inbox', icon: Inbox, k: 'i' },
  { to: '/aprovacoes', label: 'Aprovações', icon: CheckSquare, k: 'a', badge: 'drafts' },
  { to: '/descoberta', label: 'Descoberta', icon: FlaskConical, k: 'e' },
  { to: '/tarefas', label: 'Tarefas', icon: ListTodo, k: 't', badge: 'tasks' },
  { to: '/agente', label: 'Agente', icon: Bot, k: 'g' },
  { to: '/config', label: 'Config', icon: SettingsIcon, k: 'c' },
] as const;

const SHORTCUTS: [string, string][] = [
  ['d f l i a e t g c', 'trocar de tela'],
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
  const nav = useNavigate();
  const loc = useLocation();

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
        <div className="rail-foot">
          <span>agente · {llmDriver || '…'}</span>
          <button
            className="btn ghost"
            style={{
              color: 'var(--rail-muted)',
              justifyContent: 'flex-start',
              padding: '4px 8px',
            }}
            onClick={() => setShowHelp(true)}
          >
            <span className="kbd">?</span> atalhos
          </button>
          <button
            className="btn ghost"
            style={{ color: 'var(--rail-muted)', justifyContent: 'flex-start', padding: '4px 8px' }}
            onClick={logout}
          >
            <LogOut size={14} /> sair
          </button>
        </div>
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
          <Route path="/tarefas" element={<Tasks />} />
          <Route path="/agente" element={<Runs />} />
          <Route path="/agente/runs/:id" element={<Runs />} />
          <Route path="/config" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
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

export { ApiError };
