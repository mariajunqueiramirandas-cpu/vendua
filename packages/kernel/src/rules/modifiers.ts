import type { ComboSelection, ComboSlot, ProductDetail } from '../api.ts';

// Option groups and kit slots as the shopper fills them. Core counts a group's min/max in
// units (an option picked twice takes two), and refuses an add that breaks them; these say
// the same thing before the add.

type Group = ProductDetail['modifierGroups'][number];

/** Units picked in `group`: `picks` is units per picked option id (a toggle counts 1). */
export function modifierUnits(
  group: { modifiers: readonly Pick<Group['modifiers'][number], 'id'>[] },
  picks: Readonly<Record<string, number>>,
): number {
  let n = 0;
  for (const m of group.modifiers) {
    const q = picks[m.id];
    if (typeof q === 'number' && q > 0) n += q;
  }
  return n;
}

/** A required group short of its minimum (at least one unit). */
export function groupMissing(group: Pick<Group, 'required' | 'minSelect'>, units: number): boolean {
  return group.required && units < Math.max(1, group.minSelect);
}

/** The group takes no more units. */
export function groupFull(group: Pick<Group, 'maxSelect'>, units: number): boolean {
  return group.maxSelect > 0 && units >= group.maxSelect;
}

/** The most units of one option the group allows now: the option's `maxQty`, and what the
 *  group's `maxSelect` leaves after the other picks. */
export function modifierMax(
  group: Pick<Group, 'maxSelect'> & {
    modifiers: readonly Pick<Group['modifiers'][number], 'id' | 'maxQty'>[];
  },
  modifierId: string,
  picks: Readonly<Record<string, number>>,
): number {
  const m = group.modifiers.find((x) => x.id === modifierId);
  if (!m) return 0;
  const own = Math.max(1, m.maxQty ?? 1);
  if (group.maxSelect <= 0) return own;
  const others = modifierUnits(group, picks) - Math.max(0, picks[modifierId] ?? 0);
  return Math.max(0, Math.min(own, group.maxSelect - others));
}

/** The group's rule beside its name: `obrigatório`, `escolha 1–3`, `opcional`, `até 3`. */
export function groupHint(group: Pick<Group, 'required' | 'minSelect' | 'maxSelect'>): string {
  const single = group.maxSelect === 1;
  if (group.required)
    return single ? 'obrigatório' : `escolha ${Math.max(1, group.minSelect)}–${group.maxSelect}`;
  return single ? 'opcional' : `até ${group.maxSelect}`;
}

/** Units picked in a kit slot. */
export function slotUnits(slot: Pick<ComboSlot, 'id'>, value: readonly ComboSelection[]): number {
  return value.reduce((n, v) => (v.slotId === slot.id && v.qty > 0 ? n + v.qty : n), 0);
}

/** Units the slot still needs (0 = complete). */
export function slotMissing(slot: Pick<ComboSlot, 'minSelect'>, units: number): number {
  return Math.max(0, slot.minSelect - units);
}

/** The slot takes no more units. */
export function slotFull(slot: Pick<ComboSlot, 'maxSelect'>, units: number): boolean {
  return units >= slot.maxSelect;
}

/** The slot's rule beside its name: `escolha 2`, `escolha de 1 a 3`. */
export function slotHint(slot: Pick<ComboSlot, 'minSelect' | 'maxSelect'>): string {
  return slot.minSelect === slot.maxSelect
    ? `escolha ${slot.maxSelect}`
    : `escolha de ${slot.minSelect} a ${slot.maxSelect}`;
}
