import { Construction } from 'lucide-react';
import { Page } from '@/components/Page.tsx';
import { EmptyState } from '@/components/common.tsx';
import { PIPELINE_TABS } from '@/features/pipeline/tabs.ts';
export default function ReportsPage() {
  return (
    <Page title="Pipeline" tabs={PIPELINE_TABS}>
      <EmptyState icon={Construction} title="em construção" />
    </Page>
  );
}
