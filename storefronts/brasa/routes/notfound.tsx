import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main className="page">
      <header className="pagehead">
        <span className="code">MANIFESTO · 404</span>
        <h1>Fora do mapa</h1>
      </header>
      <p className="dim" style={{ maxWidth: '46ch' }}>
        essa página não consta no manifesto da noite — só a chapa, a comanda e o despacho.
      </p>
      <Link
        to="/"
        className="cta"
        style={{ display: 'inline-block', padding: '12px 26px', textDecoration: 'none' }}
      >
        Voltar ao quadro →
      </Link>
    </main>
  );
}
