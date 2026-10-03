import { PageBody, PageHeader } from '../../ui/Page.tsx';

// Placeholder: the screen is built on the ui/vendedor components (sales-agent-ux §3).
export default function Ensaio() {
  return (
    <PageBody>
      <PageHeader
        title="Ensaio"
        back={'/vendedor'}
        subtitle="A Ana escreve, você atende. Nada foi enviado."
      />
    </PageBody>
  );
}
