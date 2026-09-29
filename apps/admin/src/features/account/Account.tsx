import { Copy, Globe, Receipt, Sparkle } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { dateShort } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { ErrorState } from '../../ui/feedback.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';

const PLAN: Record<string, string> = {
  spike: 'Piloto',
  starter: 'Essencial',
  growth: 'Crescer',
  pro: 'Pro',
};

export default function Account() {
  const { data, error, refetch } = useQuery({ queryKey: qk.account, queryFn: api.account });
  if (error && !data)
    return (
      <PageBody>
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  return (
    <PageBody>
      <PageHeader title="Conta e plano" />
      {!data ? (
        <SectionsSkeleton />
      ) : (
        <div className="space-y-8">
          <Section title="Seu plano">
            <Card className="relative overflow-hidden p-5">
              <div
                aria-hidden
                className="absolute -right-12 -top-12 size-40 rounded-full bg-spark opacity-20 blur-2xl"
              />
              <p className="t-caption text-muted">Plano atual</p>
              <p className="t-title-1 mt-1">{PLAN[data.plan.id] ?? data.plan.id}</p>
              <p className="t-body text-muted">Loja criada em {dateShort(data.plan.since)}.</p>
            </Card>
          </Section>
          <Section title="Endereço da loja">
            <Card className="divide-y divide-line">
              <div className="flex items-center gap-3 p-4">
                <Globe className="size-6 shrink-0 text-muted" />
                <a
                  href={data.address}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate font-semibold underline underline-offset-2"
                >
                  {data.address.replace('https://', '')}
                </a>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Copy />}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(data.address)
                      .then(() => toast('Endereço copiado'))
                  }
                >
                  copiar
                </Button>
              </div>
              {data.domains.map((d) => (
                <div key={d} className="flex items-center gap-3 p-4">
                  <Globe className="size-6 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{d}</span>
                  <span className="t-caption rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success">
                    no ar
                  </span>
                </div>
              ))}
            </Card>
            <p className="t-caption mt-2 px-1 text-muted">
              Quer um endereço próprio, como www.sualoja.com.br? Fale com a gente em Ajuda.
            </p>
          </Section>
          <Section title="Cobrança">
            <Card className="flex items-start gap-3 p-5">
              <Receipt className="size-6 shrink-0 text-muted" />
              <div>
                <p className="inline-flex items-center gap-1.5 font-semibold">
                  Faturas e forma de pagamento{' '}
                  <Sparkle weight="fill" className="size-4 text-warning" />
                </p>
                <p className="t-body text-muted">
                  Durante o piloto não há cobrança pelo painel. Quando começar, suas faturas e o
                  cartão cadastrado aparecem aqui.
                </p>
              </div>
            </Card>
          </Section>
          <Section title="Notificações e aparência do painel">
            <Card className="p-5">
              <p className="t-body text-muted">
                Som do pedido novo, avisos no celular e tema claro ou escuro ficam no seu perfil.
              </p>
              <Link
                to="/perfil"
                className="t-label mt-3 inline-flex min-h-11 items-center rounded-md px-3 ring-1 ring-line-strong hover:bg-hover"
              >
                abrir meu perfil
              </Link>
            </Card>
          </Section>
        </div>
      )}
    </PageBody>
  );
}
