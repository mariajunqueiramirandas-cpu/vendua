import type { ReactNode } from 'react';
import type { Insumo } from '../../../lib/api.ts';
import { qty } from './units.ts';

/** an insumo's count in words: acabou, abaixo de zero, pouco, aviso */
export function stockStatus(i: Insumo): ReactNode {
  if (i.stockMilli == null) return <span className="text-muted">não conta estoque</span>;
  if (i.stockMilli < 0)
    return <span className="font-semibold text-danger">abaixo de zero · conte de novo</span>;
  if (i.stockMilli === 0) return <span className="font-semibold text-danger">acabou</span>;
  if (i.low)
    return (
      <span className="font-semibold text-warning">
        pouco · aviso com {qty(i.lowMilli!, i.unit)}
      </span>
    );
  return (
    <span className="text-muted">
      {i.lowMilli != null ? `aviso com ${qty(i.lowMilli, i.unit)}` : 'sem aviso'}
    </span>
  );
}
