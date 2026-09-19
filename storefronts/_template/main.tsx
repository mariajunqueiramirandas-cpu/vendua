import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary, SystemSurfaces, VenduaProvider } from '@vendua/kernel';
import '@vendua/kernel/styles.css';
import './styles/global.css';
import config from './vendua.config.ts';
import { App } from './routes/_app.tsx';
import { RouteError } from './routes/_components/RouteError.tsx';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');

createRoot(rootEl).render(
  <StrictMode>
    <VenduaProvider config={config}>
      <SystemSurfaces />
      <ErrorBoundary fallback={<RouteError />}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </VenduaProvider>
  </StrictMode>,
);
