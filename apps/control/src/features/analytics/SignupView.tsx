import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { api, type AnalyticsDays } from '@/lib/api.ts';
import { qk } from '@/lib/query.ts';
import { EmptyState, ErrorState, KpiStrip, LoadingRows } from '@/components/common.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { FunnelBars } from './Bars.tsx';

// the admin's own words for each question, so staff read the funnel as a merchant saw it
const SIGNUP: Record<string, string> = {
  plano: 'plano',
  loja: 'nome e endereço',
  tipo: 'o que vende',
  voce: 'dono (nome, e-mail, CPF/CNPJ)',
  whatsapp: 'WhatsApp',
  codigo: 'código do WhatsApp',
  pagamento: 'pagamento',
  pronto: 'loja criada',
};
const SETUP: Record<string, string> = {
  oi: 'boas-vindas',
  tipo: 'tipo de loja',
  importar: 'importar cardápio',
  nome: 'nome',
  logo: 'logo',
  cores: 'cores',
  frase: 'frase',
  whatsapp: 'WhatsApp da loja',
  endereco: 'endereço da loja',
  horarios: 'horários',
  como: 'retirada ou entrega',
  retirada: 'retirada',
  entrega: 'entrega',
  formas: 'formas de pagamento',
  pix: 'chave Pix',
  mercadopago: 'Mercado Pago',
  produtos: 'produtos',
  pronto: 'pronto',
};

const share = (v: number, of: number) => (of ? `${Math.round((v / of) * 100)}%` : '—');

export function SignupView({ days }: { days: AnalyticsDays }) {
  const q = useQuery({
    queryKey: qk.signupAnalytics(days),
    queryFn: () => api.signupAnalytics(days),
  });
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  const r = q.data;
  const s = r.stores;
  if (!r.siteVisitors && !s.created && !r.signup.some((x) => x.visitors))
    return (
      <EmptyState
        icon={UserPlus}
        title={`nenhum cadastro nos últimos ${days}d`}
        hint="cada pergunta do cadastro e da configuração conta como uma página, sem as respostas"
      />
    );

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        items={[
          { label: 'visitantes do site', value: r.siteVisitors, hint: 'visitante-dia' },
          {
            label: 'lojas criadas',
            value: s.created,
            hint: `${share(s.created, r.siteVisitors)} dos visitantes`,
          },
          { label: 'no teste grátis', value: s.trialing },
          { label: 'pagaram', value: s.paid, hint: `${share(s.paid, s.created)} das criadas` },
          {
            label: 'primeiro pedido',
            value: s.firstOrder,
            hint:
              s.medianDaysToFirstOrder == null
                ? `${share(s.firstOrder, s.created)} das criadas`
                : `mediana de ${s.medianDaysToFirstOrder} dia${s.medianDaysToFirstOrder === 1 ? '' : 's'}`,
          },
        ]}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="cadastro" aside="visitantes que chegaram a cada pergunta">
          <FunnelBars
            steps={r.signup.map((x) => ({ label: SIGNUP[x.step] ?? x.step, value: x.visitors }))}
          />
        </Panel>
        <Panel title="configuração da loja" aside="telas do Duá depois do cadastro">
          <FunnelBars
            steps={r.setup
              .filter((x) => x.visitors > 0 || x.step === 'oi' || x.step === 'pronto')
              .map((x) => ({ label: SETUP[x.step] ?? x.step, value: x.visitors }))}
          />
        </Panel>
      </div>
    </div>
  );
}
