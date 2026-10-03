import { PageBody, PageHeader } from '../../ui/Page.tsx';

// Placeholder: the screen is built on the ui/vendedor components (sales-agent-ux §3).
export default function ClienteOculto() {
  return (
    <PageBody>
      <PageHeader
        title="Cliente oculto"
        back={'/vendedor'}
        subtitle="Clientes de teste pedem no seu cardápio e conferimos cada pedido."
      />
    </PageBody>
  );
}
