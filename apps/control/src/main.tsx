import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import './styles/theme.css';
import App from './app/App.tsx';
import { queryClient } from './lib/query.ts';

// PWA install: prod-only registration — in dev a cache would fight vite HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/control/sw.js')
      .then((reg) => {
        // an installed PWA resumes from the background instead of reloading, so the
        // browser's own update check rarely fires — look for a new deploy on each return
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
        });
      })
      .catch(() => undefined);
  });
}

// ask the browser not to evict the app shell cache under storage pressure; granted
// silently for installed PWAs, a no-op elsewhere
void navigator.storage?.persist?.().catch(() => undefined);

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

  // html[data-kb] (the `kb:` variant): a text field has focus and the visual viewport
  // is >150px short of its height with nothing focused. Pinch-zoom shrinks it too, and
  // a desktop window resize must not count, hence the scale and pointer checks.
  const TEXT_FIELD =
    'input:not([type=checkbox],[type=radio],[type=range],[type=color],[type=file],[type=button],[type=submit],[type=reset],[type=hidden]), textarea, [contenteditable]:not([contenteditable=false])';
  const coarse = window.matchMedia('(pointer: coarse)');
  let base = vv.height;
  const kb = () => {
    const typing = document.activeElement?.matches(TEXT_FIELD) ?? false;
    const zoomed = vv.scale > 1.01;
    if (!zoomed) base = typing ? Math.max(base, vv.height) : vv.height;
    document.documentElement.toggleAttribute(
      'data-kb',
      typing && !zoomed && coarse.matches && base - vv.height > 150,
    );
  };
  // focus passes through <body> between two fields: settle before deciding
  let t = 0;
  const later = () => {
    clearTimeout(t);
    t = window.setTimeout(kb, 60);
  };
  vv.addEventListener('resize', kb);
  document.addEventListener('focusin', later);
  document.addEventListener('focusout', later);
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
