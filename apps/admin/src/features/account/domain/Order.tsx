import { ArrowsClockwise, Clock, Globe, WarningCircle, XCircle } from '@phosphor-icons/react';
import { api } from '../../../lib/api.ts';
import { Button } from '../../../ui/Button.tsx';
import { Card } from '../../../ui/Card.tsx';
import { Notice } from '../../../ui/Notice.tsx';
import { toast } from '../../../ui/Toast.tsx';
import { Chip, Host, Progress, useAccountWrite } from './kit.tsx';
import type { Order } from './status.tsx';

const OPEN = new Set<Order['status']>([
  'awaiting_payment',
  'queued',
  'pending',
  'conflict',
  'failed',
]);
/** an order the owner still sees as such (registered becomes the domain; cancelled is gone) */
export const isOpen = (o: Order | null): o is Order => !!o && OPEN.has(o.status);

const STEPS = ['Registro', 'Configuração', 'No ar'];

/** The .com.br being bought: waiting for the plan's payment, at the registry, or stuck. */
export function OrderCard({ o }: { o: Order }) {
  const cancel = useAccountWrite(
    () => api.cancelDomainOrder(o.id),
    () => toast('Pedido cancelado. Escolha outro nome.'),
  );
  const retry = useAccountWrite(
    () => api.retryDomainOrder(o.id),
    () => toast('Tentando de novo'),
  );
  const doc = o.holder.kind === 'cnpj' ? 'CNPJ' : 'CPF';
  const stuck = o.status === 'conflict' || o.status === 'failed';
  const other = (
    <Button
      variant={stuck ? 'secondary' : 'ghost'}
      size={stuck ? 'md' : 'sm'}
      loading={cancel.isPending}
      disabled={retry.isPending}
      onClick={() => cancel.mutate(undefined)}
    >
      escolher outro nome
    </Button>
  );
  const again = (label: string) => (
    <Button
      icon={<ArrowsClockwise />}
      loading={retry.isPending}
      disabled={cancel.isPending}
      onClick={() => retry.mutate(undefined)}
    >
      {label}
    </Button>
  );

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Globe className="size-6 shrink-0 text-muted" aria-hidden />
        <p className="min-w-0 flex-1 break-words font-display text-lg font-semibold">
          <Host h={o.host} />
        </p>
        {o.status === 'awaiting_payment' ? (
          <Chip tone="warning" icon={Clock}>
            esperando pagamento
          </Chip>
        ) : stuck ? (
          <Chip tone="danger" icon={o.status === 'conflict' ? WarningCircle : XCircle}>
            {o.status === 'conflict' ? 'precisa de você' : 'não deu certo'}
          </Chip>
        ) : (
          <Chip tone="info" icon={ArrowsClockwise}>
            registrando
          </Chip>
        )}
      </div>
      <Progress steps={STEPS} at={0} failed={stuck} />

      {o.status === 'awaiting_payment' ? (
        <div className="space-y-3">
          <div>
            <p className="font-semibold">Esperando o primeiro pagamento</p>
            <p className="t-body mt-0.5 text-muted">
              Quando o primeiro pagamento do plano cair, registramos {o.host} no nome de{' '}
              {o.holder.name}.
            </p>
          </div>
          {other}
        </div>
      ) : o.status === 'queued' || o.status === 'pending' ? (
        <div>
          <p className="font-semibold">
            Registrando <Host h={o.host} />
          </p>
          <p className="t-body mt-0.5 text-muted">O Registro.br costuma confirmar em até um dia.</p>
        </div>
      ) : o.status === 'conflict' ? (
        <div className="space-y-4">
          <Notice
            tone="warning"
            role="alert"
            title={`Esse ${doc} já tem domínio com outro provedor no Registro.br`}
          >
            Para registrar {o.host}, troque o provedor no Registro.br:
          </Notice>
          <ol className="t-body space-y-3">
            {[
              <>
                Entre em <span className="font-semibold">registro.br</span> com o {doc}{' '}
                <span className="tnum font-mono">{o.holder.document}</span>.
              </>,
              <>
                Em <span className="font-semibold">Titularidade</span>, procure Provedor de serviços
                e toque em <span className="font-semibold">Alterar provedor</span>.
              </>,
              <>
                Escolha{' '}
                <span className="font-semibold">
                  {o.providerName ?? 'o provedor indicado pela Venduá'}
                </span>{' '}
                e confirme.
              </>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span
                  aria-hidden
                  className="t-label grid size-7 shrink-0 place-items-center rounded-full bg-sunken"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <p className="t-caption text-muted">
            Isso muda o provedor de todos os domínios desse {doc}. Tentamos de novo todo dia por 7
            dias.
          </p>
          <div className="flex flex-wrap gap-2">
            {again('tentar agora')}
            {other}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Notice tone="danger" role="alert" title="Não conseguimos registrar o domínio">
            {o.lastError ?? 'Tente de novo ou escolha outro nome.'}
          </Notice>
          <div className="flex flex-wrap gap-2">
            {again('tentar de novo')}
            {other}
          </div>
        </div>
      )}
    </Card>
  );
}
