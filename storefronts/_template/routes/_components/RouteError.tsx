export function RouteError() {
  return (
    <main className="container page">
      <div className="empty">
        <h1>Algo quebrou ao renderizar a página.</h1>
        <p className="muted">Recarregue — se continuar assim, fale com a loja.</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Recarregar
        </button>
      </div>
    </main>
  );
}
