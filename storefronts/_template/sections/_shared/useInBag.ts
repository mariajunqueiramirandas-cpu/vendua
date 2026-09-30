import { useCart } from '@vendua/kernel';

/** How many of this product the sacola already holds (a read — adding stays with AddToCart). */
export function useInBag(productId: string): number {
  const { cart } = useCart();
  if (cart?.status !== 'open') return 0;
  return cart.items.reduce((n, i) => (i.productId === productId ? n + i.qty : n), 0);
}
