import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { qk } from '../../lib/query.ts';
import { useCan } from '../../lib/session.ts';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { ImportFlow } from './ImportFlow.tsx';

/** Cardápio › Importar: the same flow as the onboarding step, for a store that already runs. */
export default function ImportPage() {
  const nav = useNavigate();
  const owner = useCan('owner');
  const cat = useQuery({ queryKey: qk.catalog, queryFn: api.catalog });
  const hasProducts = !!cat.data?.categories.some((c) =>
    c.products.some((p) => p.status !== 'archived'),
  );
  return (
    <PageBody>
      <PageHeader
        title="Importar cardápio"
        subtitle="Traga produtos, fotos e configurações de outro app de cardápio."
        back="/cardapio"
      />
      <ImportFlow
        where="catalog"
        owner={owner}
        hasProducts={hasProducts}
        onApplied={() => nav('/cardapio', { state: { vt: 'pop' } })}
      />
    </PageBody>
  );
}
