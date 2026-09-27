const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(cents: number): string {
  return BRL.format(cents / 100);
}

export const twoDigits = (n: number) => String(n).padStart(2, '0');
