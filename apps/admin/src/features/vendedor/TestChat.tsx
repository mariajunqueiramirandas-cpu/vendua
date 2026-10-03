import { PageBody, PageHeader } from '../../ui/Page.tsx';

// Placeholder: the screen is built on the ui/vendedor components (sales-agent-ux §3).
export default function TestChat() {
  return (
    <PageBody>
      <PageHeader
        title="Testar como cliente"
        back={'/vendedor'}
        subtitle="Peça como se fosse um cliente. Nada vai para a cozinha."
      />
    </PageBody>
  );
}
