import { CARTS, DOORS, EXAMPLE, type Knobs, type Pt } from './model';

// One set of knobs, door and cart for the whole post: the map, the fee curve, the fallback and the
// comparison all read it, so moving a slider in one moves the others. Only the browser writes it;
// the prerendered page shows the example values.
export const sim: { knobs: Knobs; door: Pt; doorId: string | null; cartId: string } = $state({
  knobs: { ...EXAMPLE },
  door: { ...DOORS[0]!.at },
  doorId: DOORS[0]!.id,
  cartId: CARTS[1]!.id,
});
