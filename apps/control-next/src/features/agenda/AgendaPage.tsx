import { Construction } from 'lucide-react';
import { Page } from '@/components/Page.tsx';
import { EmptyState } from '@/components/common.tsx';

export default function AgendaPage() {
  return (
    <Page title="Agenda">
      <EmptyState icon={Construction} title="em construção" />
    </Page>
  );
}
