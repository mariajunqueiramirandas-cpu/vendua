import { Link } from 'react-router-dom';
import { CartTrigger, useCart } from '@vendua/kernel';
import { BagMark } from './marks.tsx';

/**
 * Cart trigger styled as the paper sacola. CartTrigger stamps the hook and
 * wires the click; the Link provides navigation to /sacola.
 */
export function BagButton() {
  const { cart } = useCart();
  const count = cart?.status === 'open' ? (cart?.totals.itemCount ?? 0) : 0;
  return (
    <CartTrigger asChild>
      <Link to="/sacola" className="bag-btn">
        <BagMark size={17} />
        <span>sacola</span>
        <span className="n" data-zero={count === 0}>
          {count}
        </span>
      </Link>
    </CartTrigger>
  );
}
