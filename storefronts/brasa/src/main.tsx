import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { VenduaProvider, SystemSurfaces } from '@vendua/kernel';
import '@vendua/kernel/styles.css';
import '../styles/global.css';
import config from '../vendua.config';
import { Shell } from '../routes/_shell';
import { Board } from '../routes/index';
import { Produto } from '../routes/produto';
import { Sacola } from '../routes/sacola';
import { Fechar } from '../routes/fechar';
import { Pedido } from '../routes/pedido';
import { NotFound } from '../routes/notfound';

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Board /> },
      { path: '/produto/:slug', element: <Produto /> },
      { path: '/sacola', element: <Sacola /> },
      // '/checkout' is a proxied API prefix — the page lives at /fechar.
      { path: '/fechar', element: <Fechar /> },
      { path: '/pedido/:id', element: <Pedido /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VenduaProvider config={config}>
      <SystemSurfaces />
      <RouterProvider router={router} />
    </VenduaProvider>
  </StrictMode>,
);
