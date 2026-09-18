import { Link } from 'react-router-dom';
import { Shell } from '../components/shell.tsx';
import { LoafMark } from '../components/marks.tsx';

export default function NotFound() {
  return (
    <Shell>
      <div className="empty-panel" style={{ marginTop: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, color: 'var(--mute)' }}>
          <LoafMark size={48} />
        </div>
        <h2>isso não está na vitrine</h2>
        <p>A página que você procura já saiu — ou nunca entrou na fornada.</p>
        <Link to="/" className="link-btn">
          voltar pra vitrine
        </Link>
      </div>
    </Shell>
  );
}
