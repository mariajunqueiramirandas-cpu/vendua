import { House, Question } from '@phosphor-icons/react';
import { useLocation } from 'react-router-dom';
import { ButtonLink } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/feedback.tsx';
import { ArtSearch } from '../../ui/illustrations.tsx';
import { PageBody } from '../../ui/Page.tsx';

/** Unknown /admin path — says so and shows the way back, instead of silently landing on Início. */
export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <PageBody>
      <EmptyState
        art={<ArtSearch />}
        title="Essa página não existe"
        body={
          <>
            Não achamos <span className="break-all font-mono text-sm">{pathname}</span> no painel.
            Talvez o link esteja errado ou a página tenha mudado de lugar.
          </>
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink to="/" icon={<House />}>
              Ir para o início
            </ButtonLink>
            <ButtonLink to="/ajuda" variant="secondary" icon={<Question />}>
              Pedir ajuda
            </ButtonLink>
          </div>
        }
      />
    </PageBody>
  );
}
