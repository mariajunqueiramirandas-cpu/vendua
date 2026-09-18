export function RouteError() {
  return (
    <main className="container" style={{ paddingBlock: '96px 64px' }}>
      <p className="eyebrow">Algo saiu do ponto</p>
      <h1 className="display display-lg" style={{ marginTop: 16 }}>
        A página quebrou no meio do preparo.
      </h1>
      <p className="small muted" style={{ marginTop: 16, maxWidth: '28rem' }}>
        Recarregue a página — se continuar assim, chame a gente no WhatsApp.
      </p>
      <button type="button" className="btn" style={{ marginTop: 32 }} onClick={() => window.location.reload()}>
        Recarregar
      </button>
    </main>
  );
}
