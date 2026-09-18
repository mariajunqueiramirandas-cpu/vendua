import { formatBRL } from '../_lib/format.ts';

export function Price({ cents, className }: { cents: number; className?: string }) {
  return <span className={className}>{formatBRL(cents)}</span>;
}
