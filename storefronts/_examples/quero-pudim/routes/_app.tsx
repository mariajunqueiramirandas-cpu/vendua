import { Route, Routes } from 'react-router-dom';
import { Layout } from './_layout.tsx';
import { CartPage } from './cart.tsx';
import { CatalogPage } from './catalog.tsx';
import { CheckoutPage } from './checkout.tsx';
import { LandingPage } from './index.tsx';
import { MyOrdersPage } from './meus-pedidos.tsx';
import { NotFoundPage } from './not-found.tsx';
import { OrderPage } from './pedido.tsx';
import { ProductPage } from './produto.tsx';
import { QrCodePage } from './qrcode.tsx';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route path="catalog" element={<CatalogPage />} />
        <Route path="produto/:slug" element={<ProductPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="pedido/:id" element={<OrderPage />} />
        <Route path="meus-pedidos" element={<MyOrdersPage />} />
        <Route path="qrcode" element={<QrCodePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
