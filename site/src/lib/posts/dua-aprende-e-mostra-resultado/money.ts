// Money is integer cents everywhere in these widgets; this only formats it, the way Core's cards do.
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const brl = (cents: number) => BRL.format(cents / 100);

/** "R$ 1,2 mil" for chart axes, where the full amount would crowd the labels */
export function brlShort(cents: number): string {
  const reais = Math.round(cents / 100);
  if (reais < 1000) return `R$ ${reais}`;
  const k = Math.round(reais / 100) / 10;
  return `R$ ${String(k).replace('.', ',')} mil`;
}
