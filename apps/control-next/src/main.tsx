import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/space-grotesk/wght.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import './styles/theme.css';
import App from './app/App.tsx';
import { queryClient } from './lib/query.ts';

// PWA install: prod-only registration — in dev a cache would fight vite HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/control/sw.js').catch(() => undefined);
  });
}

// --vvh/--vvo: iOS Safari's software keyboard doesn't shrink the layout
// viewport, so the phone shell (h-vv) pins to these vars instead of 100dvh.
const vv = window.visualViewport;
if (vv) {
  const sync = () => {
    const s = document.documentElement.style;
    s.setProperty('--vvh', `${vv.height}px`);
    s.setProperty('--vvo', `${vv.offsetTop}px`);
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
}

// hash routes keep deep links working under the /control/* prefix without server rewrites
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
