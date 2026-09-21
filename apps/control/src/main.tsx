import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@fontsource-variable/space-grotesk/wght.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import App from './App.tsx';
import './styles.css';

// PWA install: prod-only registration — in dev a cache would fight vite HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/control/sw.js').catch(() => undefined);
  });
}

// Visual viewport → --vvh/--vvo on :root. The software keyboard doesn't
// shrink the layout viewport on iOS Safari (and on Chrome without
// interactive-widget=resizes-content), so styles.css pins the shell and
// overlays to these vars instead of 100dvh. On desktop they just mirror
// the window size and are never consumed outside the phone breakpoints.
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

// HashRouter: the SPA is served by Core at /control/* — hash routes keep
// deep links working under any path prefix without server rewrites.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
