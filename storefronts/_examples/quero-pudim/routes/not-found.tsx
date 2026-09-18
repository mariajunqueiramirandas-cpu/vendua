import { ArrowLeft, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="container">
      <div className="empty-state" style={{ maxWidth: '32rem', marginInline: 'auto' }}>
        <ShoppingBag size={32} style={{ color: 'var(--caramel-700)' }} aria-hidden="true" />
        <h1 className="display display-lg">Essa página saiu do forno errada.</h1>
        <p>O endereço não existe — mas o cardápio de hoje está logo ali.</p>
        <Link to="/catalog" className="btn">
          <ArrowLeft size={16} aria-hidden="true" /> Ver cardápio
        </Link>
      </div>
    </main>
  );
}
