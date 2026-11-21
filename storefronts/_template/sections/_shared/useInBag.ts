import { useCart } from '@vendua/kernel';

/** How many of this product the sacola already holds, including kit picks (a read — adding stays with AddToCart). */
export function useInBag(productId: string): number {
  const { cart } = useCart();
  if (cart?.status !== 'open') return 0;
  let n = 0;
  for (const i of cart.items) {
    if (i.productId === productId) n += i.qty;
    for (const c of i.comboSelections ?? i.combo ?? []) {
      if (c.productId === productId) n += c.qty * i.qty;
    }
  }
  return n;
}
