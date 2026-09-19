import { Route, Routes } from 'react-router-dom';
import { Layout } from './_layout.tsx';
import { CartPage } from './cart.tsx';
import { CheckoutPage } from './checkout.tsx';
import { CatalogPage } from './index.tsx';
import { NotFoundPage } from './not-found.tsx';
import { OrderPage } from './pedido.tsx';
import { ProductPage } from './produto.tsx';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CatalogPage />} />
        <Route path="produto/:slug" element={<ProductPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="pedido/:id" element={<OrderPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
