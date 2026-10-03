import { PageBody, PageHeader } from '../../ui/Page.tsx';

// Placeholder: the screen is built on the ui/vendedor components (sales-agent-ux §3).
export default function Results() {
  return (
    <PageBody>
      <PageHeader
        title="Resultados"
        back={'/vendedor'}
        subtitle="O que a Ana vendeu e o que dá pra melhorar."
      />
    </PageBody>
  );
}
