import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@fontsource-variable/space-grotesk/wght.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import App from './App.tsx';
import './styles.css';

// HashRouter: the SPA is served by Core at /control/* — hash routes keep
// deep links working under any path prefix without server rewrites.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
