import { Construction } from 'lucide-react';
import { Page } from '@/components/Page.tsx';
import { EmptyState } from '@/components/common.tsx';

export default function LeadPage() {
  return (
    <Page title="Lead" back="/pipeline">
      <EmptyState icon={Construction} title="em construção" />
    </Page>
  );
}
