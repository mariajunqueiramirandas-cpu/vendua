import { PageBody, PageHeader } from '../../ui/Page.tsx';

// Placeholder: the screen is built on the ui/vendedor components (sales-agent-ux §3).
export default function Conversation() {
  return (
    <PageBody>
      <PageHeader
        title="Conversa"
        back={'/vendedor/conversas'}
        subtitle="A conversa, a sacola e quem está atendendo."
      />
    </PageBody>
  );
}
