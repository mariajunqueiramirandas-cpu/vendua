import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main id="main" className="container page">
      <div className="empty">
        <h1>Página não encontrada.</h1>
        <p className="muted">O endereço não existe — o cardápio está logo ali.</p>
        <Link to="/" className="btn">
          Ver cardápio
        </Link>
      </div>
    </main>
  );
}
