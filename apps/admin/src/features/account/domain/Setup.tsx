import { ArrowsClockwise, Globe, ListBullets, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { api, type Account } from '../../../lib/api.ts';
import { ago, plural } from '../../../lib/format.ts';
import { Button } from '../../../ui/Button.tsx';
import { Card } from '../../../ui/Card.tsx';
import { Disclosure } from '../../../ui/Disclosure.tsx';
import { HoldButton } from '../../../ui/HoldButton.tsx';
import { toast } from '../../../ui/Toast.tsx';
import { Callout, Host, Progress, useAccountWrite } from './kit.tsx';
import { CnameRecords, NameServers, RecordsEditor } from './Records.tsx';
import { dateLong, DomainChip, stepsOf, type Domain } from './status.tsx';

/** The custom domain after it's added: where it is, what the owner does next, per method. */
export function DomainSetup({ d, a }: { d: Domain; a: Account }) {
  const edgeIpv4 = a.domainOptions.edgeIpv4;
  const check = useAccountWrite(
    () => api.checkDomain(d.id),
    (n) => {
      const s = n.customDomain?.status;
      const waiting = s === 'pending_dns' || s === 'failed' || s === 'repairing';
      toast(
        waiting ? 'Ainda não achamos a mudança. Pode levar algumas horas.' : 'DNS conferido ✓',
        { tone: waiting ? 'info' : 'ok' },
      );
    },
  );
  const ns = d.method === 'ns';
  const included = d.source === 'included';
  const awaitingRecords = ns && !included && !d.recordsConfirmed;
  const { steps, at } = stepsOf(d);
  const failed = d.status === 'failed';
  // what the owner does at their provider: records (cname) or the server pair (ns)
  const instructions = ns ? <NameServers d={d} /> : <CnameRecords d={d} edgeIpv4={edgeIpv4} />;
  const canCheck =
    !awaitingRecords &&
    (failed ||
      d.status === 'repairing' ||
      d.status === 'dns_ok' ||
      (d.status === 'pending_dns' && !included));

  return (
    <div className="space-y-3">
      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Globe className="size-6 shrink-0 text-muted" aria-hidden />
          <p className="min-w-0 flex-1 break-words font-display text-lg font-semibold">
            <Host h={d.host} />
          </p>
          <DomainChip status={d.status} />
        </div>
        {d.status === 'repairing' || d.status === 'lapsed' ? null : (
          <Progress steps={steps} at={at} failed={failed} />
        )}

        {d.status === 'ordering' ? (
          <p className="t-body">O Registro.br costuma confirmar em até um dia.</p>
        ) : d.status === 'active' ? (
          <div className="t-body space-y-2">
            <p>
              Pronto: a loja está no ar em{' '}
              <a
                href={`https://${d.host}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                {d.host}
              </a>
              .
            </p>
            {included ? (
              <p className="text-muted">
                Renovamos sozinhos enquanto seu plano incluir domínio.
                {d.expiresAt ? ` Vence em ${dateLong(d.expiresAt)}.` : ''}
              </p>
            ) : null}
          </div>
        ) : d.status === 'dns_ok' ? (
          <p className="t-body rounded-md bg-info-soft p-3">
            Tudo certo com o DNS ✓. Estamos emitindo o certificado de segurança; leva alguns
            minutos.
          </p>
        ) : d.status === 'lapsed' ? (
          <div className="t-body space-y-2">
            <p>
              Seu plano não inclui mais domínio próprio, então {d.host} leva os clientes para o
              endereço Venduá.
            </p>
            {included ? (
              <p className="text-muted">
                O domínio continua seu. Para não perder, renove no Registro.br: em Provedor de
                serviços escolha Nenhum (0) e renove por lá
                {d.expiresAt ? ` até ${dateLong(d.expiresAt)}` : ''}.
              </p>
            ) : null}
          </div>
        ) : awaitingRecords ? (
          <>
            <p className="t-body">
              Antes de trocar os servidores, confira os registros do seu domínio. O que não estiver
              aqui para de funcionar, inclusive o e-mail.
            </p>
            <RecordsEditor d={d} confirm />
          </>
        ) : included && d.status === 'pending_dns' ? (
          <p className="t-body">
            Registrado ✓. Estamos ligando o domínio à sua loja; não precisa fazer nada.
          </p>
        ) : (
          <>
            {d.status === 'repairing' ? (
              <Callout
                tone="danger"
                icon={WarningCircle}
                title={`${d.host} parou de apontar para a Venduá`}
              >
                Enquanto isso a loja continua no endereço Venduá.
              </Callout>
            ) : failed ? (
              <Callout tone="danger" icon={WarningCircle} title="Não conseguimos confirmar o DNS">
                {d.lastError ??
                  (ns
                    ? 'Confira se os servidores no Registro.br são os dois abaixo.'
                    : 'Confira se os dois registros abaixo estão iguais no seu provedor.')}
              </Callout>
            ) : null}
            {included && failed ? null : instructions}
          </>
        )}

        {canCheck ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant={d.status === 'dns_ok' ? 'secondary' : 'primary'}
              icon={<ArrowsClockwise />}
              loading={check.isPending}
              onClick={() => check.mutate(undefined)}
            >
              {failed ? 'tentar de novo' : 'verificar agora'}
            </Button>
            {d.lastCheckedAt ? (
              <span className="t-caption text-muted">conferido {ago(d.lastCheckedAt)}</span>
            ) : null}
          </div>
        ) : null}

        {d.source === 'connected' ? <Remove d={d} /> : null}
      </Card>

      {ns && (included || d.recordsConfirmed) && d.status !== 'ordering' ? (
        <Disclosure
          title="registros do domínio"
          summary={
            d.records.length
              ? plural(d.records.length, 'registro', 'registros')
              : 'e-mail e outros serviços do domínio'
          }
          icon={<ListBullets />}
        >
          <RecordsEditor d={d} confirm={false} />
        </Disclosure>
      ) : null}
    </div>
  );
}

function Remove({ d }: { d: Domain }) {
  const [open, setOpen] = useState(false);
  const remove = useAccountWrite(
    () => api.removeDomain(d.id),
    () => toast('Domínio removido'),
  );
  // a delegated zone is deleted with the domain: the servers must move back first
  const delegated = d.method === 'ns' && d.recordsConfirmed;
  return (
    <div className="border-t border-line pt-4">
      {open ? (
        <div className="space-y-2">
          <p className="t-body text-muted">
            A loja sai de {d.host} e continua no endereço Venduá.
            {delegated
              ? ' Antes, volte os Servidores DNS no Registro.br para os do seu provedor antigo: sem isso, o domínio e o e-mail param de funcionar.'
              : ''}
          </p>
          <HoldButton onConfirm={() => remove.mutate(undefined)} disabled={remove.isPending}>
            segure para remover o domínio
          </HoldButton>
          <Button variant="ghost" block onClick={() => setOpen(false)}>
            deixar como está
          </Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="!text-danger" onClick={() => setOpen(true)}>
          remover domínio
        </Button>
      )}
    </div>
  );
}
