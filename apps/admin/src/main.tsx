import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/figtree/wght.css';
import '@fontsource-variable/space-grotesk/wght.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import './ui/theme.css';
import App from './app/App.tsx';
import { queryClient } from './lib/query.ts';
import { persistCache, restoreCache } from './lib/persist.ts';
import { startPwa } from './lib/pwa.ts';
import { applyTheme } from './lib/theme.ts';

applyTheme();

// the service worker is prod-only: in dev a cache would fight vite HMR
startPwa();
void navigator.storage?.persist?.().catch(() => undefined);

await restoreCache(queryClient);
persistCache(queryClient);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* no startTransition: a screen whose chunk is slow (fresh deploy, cold cache) must show its
          skeleton at once, not leave the old one frozen */}
      <BrowserRouter basename="/admin">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
