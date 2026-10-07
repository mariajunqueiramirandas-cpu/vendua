import { Bag, ForkKnife, Moped, type Icon } from '@phosphor-icons/react';
import type { OrderMode } from '../lib/api.ts';

/** The Kernel's order path has two shapes: a dine-in order walks the pickup one (never "saiu"). */
export const pathMode = (mode: OrderMode): 'pickup' | 'delivery' =>
  mode === 'delivery' ? 'delivery' : 'pickup';

/** "Mesa 5" for a bare number, the label as the store wrote it otherwise. */
export const tableName = (label: string) => (/^\d+$/.test(label.trim()) ? `Mesa ${label}` : label);

/** How the order reaches the customer, in a word and an icon: Entrega, Retirada, Mesa 5, No local. */
export function modeOf(d: { mode: OrderMode; table?: string | null | undefined }): {
  label: string;
  Icon: Icon;
} {
  if (d.mode === 'delivery') return { label: 'Entrega', Icon: Moped };
  if (d.mode === 'dine_in')
    return { label: d.table ? tableName(d.table) : 'No local', Icon: ForkKnife };
  return { label: 'Retirada', Icon: Bag };
}
