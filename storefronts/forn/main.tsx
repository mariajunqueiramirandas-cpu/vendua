import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { SystemSurfaces, useStore, VenduaProvider } from '@vendua/kernel';
import '@vendua/kernel/styles.css';
import './styles/global.css';
import config from './vendua.config.ts';
import { SessionResetProvider } from './components/session.tsx';
import Home from './routes/index.tsx';
import ProductPage from './routes/product.tsx';
import SacolaPage from './routes/sacola.tsx';
import CheckoutPage from './routes/checkout.tsx';
import PedidoPage from './routes/pedido.tsx';
import NotFound from './routes/not-found.tsx';

/**
 * The app root sets `data-status` so the whole storefront shifts into its
 * after-hours palette when Core says the shop is closed — the system notice
 * remains Kernel-rendered via <SystemSurfaces /> (with our sign override).
 */
function Frame() {
  const { status } = useStore();
  useEffect(() => {
    document.body.style.backgroundColor = status === 'closed' ? '#211812' : '#f2e9d5';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', status === 'closed' ? '#211812' : '#f2e9d5');
  }, [status]);
  return (
    <div className="forn-app" data-status={status ?? 'loading'}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/produto/:slug" element={<ProductPage />} />
        <Route path="/sacola" element={<SacolaPage />} />
        <Route path="/finalizar" element={<CheckoutPage />} />
        <Route path="/pedido/:id" element={<PedidoPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <VenduaProvider config={config}>
      <SessionResetProvider>
        <SystemSurfaces />
        <Frame />
      </SessionResetProvider>
    </VenduaProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
