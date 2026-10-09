import { formatCentsParts, useStore } from '@vendua/kernel';

/**
 * A price set the way menus print them: the currency sign small and light, the figure in
 * tabular digits. The Kernel splits Core's cents in the store's currency.
 */
export function Price({ cents, className }: { cents: number; className?: string }) {
  const { store } = useStore();
  const { symbol, amount, symbolFirst } = formatCentsParts(cents, store?.currency);
  return symbolFirst ? (
    <span className={className}>
      <span className="price-cur">{symbol}</span>
      {amount}
    </span>
  ) : (
    <span className={className}>
      {amount}
      <span className="price-cur" data-after="">
        {symbol}
      </span>
    </span>
  );
}
