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
  { to: '/aprovacoes', label: 'Aprovações', icon: CheckSquare, k: 'a' },
  { to: '/descoberta', label: 'Descoberta', icon: FlaskConical, k: 'e' },
  { to: '/tarefas', label: 'Tarefas', icon: ListTodo, k: 't' },
  { to: '/agente', label: 'Agente', icon: Bot, k: 'g' },
  { to: '/config', label: 'Config', icon: SettingsIcon, k: 'c' },
];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    api
      .session()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

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
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <n.icon /> {n.label} <span className="kbd">{n.k}</span>
          </NavLink>
        ))}
        <div className="rail-foot">
          <span>agente · openrouter</span>
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
    </div>
  );
}

export { ApiError };
