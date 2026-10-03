import { PageBody, PageHeader } from '../../ui/Page.tsx';

// Placeholder: the screen is built on the ui/vendedor components (sales-agent-ux §3).
export default function Teach() {
  return (
    <PageBody>
      <PageHeader
        title="Ensinar"
        back={'/vendedor'}
        subtitle="O que a Ana sabe sobre a sua loja: respostas e regras."
      />
    </PageBody>
  );
}
