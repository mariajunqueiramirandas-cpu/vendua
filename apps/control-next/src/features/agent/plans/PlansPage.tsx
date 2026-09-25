import { Construction } from 'lucide-react';
import { Page } from '@/components/Page.tsx';
import { EmptyState } from '@/components/common.tsx';
import { AGENT_TABS } from '../tabs.ts';
export default function PlansPage() {
  return (
    <Page title="Agente" tabs={AGENT_TABS}>
      <EmptyState icon={Construction} title="em construção" />
    </Page>
  );
}
