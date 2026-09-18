import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary, SystemSurfaces, VenduaProvider } from '@vendua/kernel';
// The Kernel README documents `@vendua/kernel/src/styles.css`, but the package
// `exports` map only exposes "." and "./config" — the subpath fails to resolve.
// Loading the same file by relative path until the exports map grows the entry.
import '../../packages/kernel/src/styles.css';
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
