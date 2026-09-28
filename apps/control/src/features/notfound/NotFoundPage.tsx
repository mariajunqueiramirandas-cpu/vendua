import { Link, useLocation } from 'react-router-dom';
import { Home, SearchX } from 'lucide-react';
import { EmptyState } from '@/components/common.tsx';
import { Page } from '@/components/Page.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';

/** Unknown CRM route — named, with a way back, instead of a silent redirect to Início. */
export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <Page title="Página não encontrada">
      <EmptyState
        icon={SearchX}
        title="Essa página não existe"
        hint={
          <>
            Nada em <span className="break-all font-mono">{pathname}</span>. O link pode estar
            errado ou a tela mudou de lugar.
          </>
        }
        action={
          <>
            <Link to="/" className={buttonVariants({ variant: 'default', size: 'sm' })}>
              <Home /> Início
            </Link>
            <Link to="/pipeline" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Pipeline
            </Link>
          </>
        }
      />
    </Page>
  );
}
