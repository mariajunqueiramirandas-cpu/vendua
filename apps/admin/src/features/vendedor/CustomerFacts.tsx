import { LockSimple } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CustomerFact } from '../../lib/api.ts';
import { dateShort } from '../../lib/format.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { useCan, useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';

type Facts = { facts: CustomerFact[] };

// the keys Duá's remember tool writes (agent-host/agents/vendedor/tools-conversation.ts)
const LABEL: Record<string, string> = {
  nome: 'Nome',
  idioma: 'Idioma',
  preferencia: 'Preferência',
  endereco_nota: 'Sobre o endereço',
  alergia: 'Alergia',
  restricao: 'Restrição',
};

const labelOf = (f: CustomerFact) => {
  const k = f.label || f.key.split('.')[0] || f.key;
  return LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
};

const valueOf = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(valueOf).filter(Boolean).join(', ');
  if (typeof v === 'object') return Object.values(v).map(valueOf).filter(Boolean).join(', ');
  return '';
};

/**
 * "O que o Duá sabe" on the customer page (sales-agent-ux §3.11): what Duá remembers
 * about this shopper, each with when he noted it and "esquecer". Nothing while it's off.
 */
export function CustomerFacts({ phone, customer }: { phone: string; customer: string }) {
  const s = useSession();
  const manager = useCan('manager');
  const on = !!s.vendedor?.enabled && manager;
  const qc = useQueryClient();
  const key = qk.customerFacts(phone);
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api.vendedor.customerFacts(phone),
    enabled: on,
  });
  const forget = useMutation({
    mutationFn: (f: CustomerFact) => api.vendedor.forgetFact(phone, f.key),
    onMutate: (f) =>
      optimistic<Facts>(qc, key, (o) => ({ facts: o.facts.filter((x) => x.key !== f.key) })),
    onSuccess: (r, f) => {
      qc.setQueryData(key, r);
      toast(`O Duá esqueceu: ${valueOf(f.value) || labelOf(f).toLowerCase()}.`);
    },
    onError: (e, _f, ctx) => {
      ctx?.restore();
      toast.error(messageOf(e));
    },
  });
  if (!on || (error && !data)) return null;
  const first = customer.split(' ')[0] || customer;
  return (
    <Section
      title="O que o Duá sabe"
      hint={`Ele lembra disso nos próximos pedidos de ${first}. Apagar os dados do cliente apaga isto também.`}
    >
      {!data ? (
        <RowsSkeleton rows={2} avatar={false} />
      ) : data.facts.length ? (
        <Card as="div" className="divide-y divide-line">
          {data.facts.map((f) => (
            <div key={f.key} className="flex min-h-16 items-center gap-3 py-2.5 pl-4 pr-2">
              <div className="min-w-0 flex-1">
                <p className="t-caption text-muted">{labelOf(f)}</p>
                <p className="t-body-lg font-semibold leading-6 [overflow-wrap:anywhere]">
                  {valueOf(f.value)}
                </p>
                <p className="t-caption mt-0.5 flex flex-wrap items-center gap-x-1.5 text-muted">
                  <span>o Duá anotou em {dateShort(f.at).split(', ').pop()}</span>
                  {f.sensitive ? (
                    <span className="inline-flex items-center gap-1">
                      <LockSimple weight="bold" className="size-3.5" aria-hidden />
                      com o ok do cliente
                    </span>
                  ) : null}
                </p>
              </div>
              <Button
                variant="ghost"
                className="shrink-0 text-muted"
                loading={forget.isPending && forget.variables?.key === f.key}
                onClick={() => forget.mutate(f)}
                aria-label={`esquecer: ${labelOf(f)}, ${valueOf(f.value)}`}
              >
                esquecer
              </Button>
            </div>
          ))}
        </Card>
      ) : (
        <Card className="t-body p-4 text-muted">
          O Duá ainda não anotou nada sobre {first}. Uma preferência contada no WhatsApp aparece
          aqui.
        </Card>
      )}
    </Section>
  );
}
