import type { StoreProfile } from '../api.ts';
import { formatWhen } from '../rules/format.ts';
import { takesOrders } from '../rules/hours.ts';

/** Why a closed store won't take this bag (the cart and checkout pages); null when it will. */
export function closedNote(
  store: StoreProfile | undefined,
  items: readonly { requiresPreorder?: boolean | undefined }[],
  bag: string,
): string | null {
  if (!store || store.status !== 'closed' || takesOrders(store.status, store, items)) return null;
  const when = store.resumesAt ? formatWhen(store.resumesAt, store.hours.timezone) : null;
  if (store.preorder?.whileClosed)
    return `Fora do horário, aceitamos só encomendas: deixe na ${bag} apenas os itens de encomenda${
      when ? ` ou volte ${when}` : ''
    }.`;
  return when
    ? `Estamos fechados — abrimos ${when}. Seus itens ficam na ${bag} até lá.`
    : `Estamos fechados agora. Seus itens continuam na ${bag}.`;
}
