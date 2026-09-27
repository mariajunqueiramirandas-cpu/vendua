import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { StorefrontRoutes, SystemSurfaces, VenduaProvider } from '@vendua/kernel';
import storefront from 'virtual:vendua/storefront';
import '@vendua/kernel/styles.css';
import './styles/global.css';
import config from './vendua.config.ts';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');

createRoot(rootEl).render(
  <StrictMode>
    <VenduaProvider config={config} storefront={storefront}>
      <SystemSurfaces />
      <BrowserRouter>
        <StorefrontRoutes />
      </BrowserRouter>
    </VenduaProvider>
  </StrictMode>,
);
