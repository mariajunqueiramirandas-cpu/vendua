import { PageBody, PageHeader } from '../../ui/Page.tsx';

// Placeholder: the screen is built on the ui/vendedor components (sales-agent-ux §3).
export default function VendedorSettings() {
  return (
    <PageBody>
      <PageHeader
        title="Configurar"
        back={'/vendedor'}
        subtitle="Como a Ana fala e o que ela pode fazer."
      />
    </PageBody>
  );
}
