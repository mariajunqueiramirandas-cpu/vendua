import { ArrowRight, Copy, Globe } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { api, type Account } from '../../lib/api.ts';
import { useLandOnHash } from '../../lib/hash.ts';
import { qk } from '../../lib/query.ts';
import { can, useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { copyText } from '../../ui/CopyValue.tsx';
import { DuaNote, ErrorState } from '../../ui/feedback.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { Addresses } from '../account/domain/Addresses.tsx';
import { CustomDomain } from '../account/domain/CustomDomain.tsx';
import { SiteRequest } from './SiteRequest.tsx';
import { useStoreQuery } from './StatusPill.tsx';

// Loja › Site e endereço: where customers find the store on the web. The Venduá address is
// everyone's; the custom domain and the site sob medida come with the plan, so they're the
// owner's (they used to sit in Conta e plano, beside the bill).

export default function StoreSite() {
  const session = useSession();
  const owner = can(session.user.role, 'owner');
  return (
    <PageBody>
      <PageHeader
        title="Site e endereço"
        back="/loja"
        subtitle="Onde os clientes acham a loja na internet."
      />
      {owner ? <OwnerView /> : <ManagerView />}
    </PageBody>
  );
}

function OwnerView() {
  const { data: a, error, refetch } = useQuery({ queryKey: qk.account, queryFn: api.account });
  useLandOnHash(!!a);
  if (error && !a) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!a) return <SectionsSkeleton />;
  const domain = a.plan.features.customDomain || !!a.customDomain;
  return (
    <div className="space-y-8">
      <Section title="Endereços da loja" id="enderecos" hint="Todo endereço em que a loja abre.">
        <Addresses a={a} />
      </Section>
      {/* a lapsed domain stays in view after the plan loses the feature: it's still the owner's */}
      {domain ? (
        <Section
          title="Domínio próprio"
          id="dominio"
          hint="Seus clientes entram na loja pelo seu endereço, como www.sualoja.com.br."
        >
          <CustomDomain a={a} />
        </Section>
      ) : null}
      {a.plan.features.customSite ? (
        <Section
          title="Site sob medida"
          id="site"
          hint={
            a.plan.features.copilot
              ? 'Feito só para a sua loja, a partir de uma conversa com o Duá.'
              : 'Um site feito para a sua loja pelo nosso agente de IA.'
          }
        >
          <SiteRequest a={a} />
        </Section>
      ) : null}
      {!domain || !a.plan.features.customSite ? <Upgrade a={a} /> : null}
    </div>
  );
}

/** What a bigger plan adds here, one tap from the plans. */
function Upgrade({ a }: { a: Account }) {
  const missing = [
    !a.plan.features.customDomain && !a.customDomain ? 'um domínio só seu' : null,
    !a.plan.features.customSite ? 'um site feito sob medida' : null,
  ].filter(Boolean);
  return (
    <Card className="flex flex-wrap items-center gap-4 p-5">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-spark-soft text-ink">
        <Globe weight="duotone" className="size-6" aria-hidden />
      </span>
      <p className="t-body min-w-0 flex-1 basis-56 text-muted">
        Nos planos maiores, a loja ganha {missing.join(' e ')}.
      </p>
      <ButtonLink to="/conta" variant="secondary" size="sm">
        ver os planos <ArrowRight weight="bold" />
      </ButtonLink>
    </Card>
  );
}

function ManagerView() {
  const { data: s, error, refetch } = useStoreQuery();
  if (error && !s) return <ErrorState error={error} retry={() => void refetch()} />;
  if (!s) return <SectionsSkeleton />;
  const host = s.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    <div className="space-y-8">
      <Section title="Endereço da loja" id="enderecos">
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <Globe className="size-6 shrink-0 text-muted" aria-hidden />
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 break-words font-semibold underline underline-offset-2"
          >
            {host}
          </a>
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy />}
            onClick={() => void copyText(s.url).then((ok) => ok && toast('Endereço copiado'))}
          >
            copiar
          </Button>
        </Card>
      </Section>
      <DuaNote pose="seguranca" title="Domínio próprio e site sob medida ficam com o dono">
        Eles vêm com o plano da loja, então quem é dono cuida deles.
      </DuaNote>
    </div>
  );
}
