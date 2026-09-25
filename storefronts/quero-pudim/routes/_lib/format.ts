const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// money display should come from the platform (locale+currency); until then every surface formats here
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}
